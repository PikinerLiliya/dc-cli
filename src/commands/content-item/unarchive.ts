import { Arguments, Argv } from 'yargs';
import { ConfigurationParameters } from '../configure';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import { ArchiveLog } from '../../common/archive/archive-log';
import paginator from '../../common/dc-management-sdk-js/paginator';
import { confirmArchive } from '../../common/archive/archive-helpers';
import ArchiveOptions from '../../common/archive/archive-options';
import { ContentItem } from 'dc-management-sdk-js';
import { equalsOrRegex } from '../../common/filter/filter';
import { getDefaultLogPath } from '../../common/log-helpers';

export const command = 'unarchive [id]';

export const desc = 'Unarchive Content Items';

export const LOG_FILENAME = (platform: string = process.platform): string =>
  getDefaultLogPath('content-item', 'unarchive', platform);

export const builder = (yargs: Argv): void => {
  yargs
    .positional('id', {
      type: 'string',
      describe:
        'The ID of a content item to be unarchived. If id is not provided, this command will unarchive ALL content items through all content repositories in the hub.'
    })
    .option('repoId', {
      type: 'string',
      describe: 'The ID of a content repository to search items in to be unarchived.',
      requiresArg: false
    })
    .option('folderId', {
      type: 'string',
      describe: 'The ID of a folder to search items in to be unarchived.',
      requiresArg: false
    })
    .option('name', {
      type: 'string',
      describe:
        'The name of a Content Item to be unarchived.\nA regex can be provided to select multiple items with similar or matching names (eg /.header/).\nA single --name option may be given to match a single content item pattern.\nMultiple --name options may be given to match multiple content items patterns at the same time, or even multiple regex.'
    })
    .option('contentType', {
      type: 'string',
      describe:
        'The ID of a Content type to unarchive all content items.\nA single --contentType option may be given to match a single content type pattern.\nMultiple --contentType options may be given to match multiple content type patterns at the same time.'
    })
    .option('revertLog', {
      type: 'string',
      describe:
        'Path to a log file containing content items archived in a previous run of the archive command.\nWhen provided, unarchives all content items listed as ARCHIVE in the log file.',
      requiresArg: false
    })
    .alias('f', 'force')
    .option('f', {
      type: 'boolean',
      boolean: true,
      describe: 'If present, there will be no confirmation prompt before unarchiving the found content.'
    })
    .alias('s', 'silent')
    .option('s', {
      type: 'boolean',
      boolean: true,
      describe: 'If present, no log file will be produced.'
    })
    .option('ignoreError', {
      type: 'boolean',
      boolean: true,
      describe: 'If present, unarchive requests that fail will not abort the process.'
    })
    .option('logFile', {
      type: 'string',
      default: LOG_FILENAME,
      describe: 'Path to a log file to write to.'
    });
};

export const handler = async (argv: Arguments<ArchiveOptions & ConfigurationParameters>): Promise<void> => {
  const { id, logFile, force, silent, ignoreError, hubId, revertLog, repoId, folderId, name, contentType } = argv;
  const client = dynamicContentClientFactory(argv);

  let contentItems: ContentItem[] = [];
  let allContent = false;
  let missingContent = false;

  if (repoId && id) {
    console.log('ID of content item is specified, ignoring repository ID');
  }

  if (id && name) {
    console.log('Please specify either a item name or an ID - not both.');
    return;
  }

  if (repoId && folderId) {
    console.log('Folder is specified, ignoring repository ID');
  }

  if (id != null) {
    try {
      const contentItem = await client.contentItems.get(id);
      contentItems = [contentItem];
    } catch (e) {
      console.log(`Fatal error: could not find content item with ID ${id}. Error: \n${e.toString()}`);
      return;
    }
  } else {
    try {
      const hub = await client.hubs.get(hubId);
      const repoIds = typeof repoId === 'string' ? [repoId] : repoId || [];
      const folderIds = typeof folderId === 'string' ? [folderId] : folderId || [];

      const contentRepositories = await (repoId != null
        ? Promise.all(repoIds.map(id => client.contentRepositories.get(id)))
        : paginator(hub.related.contentRepositories.list));

      const folders = folderId != null ? await Promise.all(folderIds.map(id => client.folders.get(id))) : [];

      folderId != null
        ? await Promise.all(
            folders.map(async source => {
              const items = await paginator(source.related.contentItems.list);

              Array.prototype.push.apply(
                contentItems,
                items.filter(item => item.status != 'ACTIVE')
              );
            })
          )
        : await Promise.all(
            contentRepositories.map(async source => {
              const items = await paginator(source.related.contentItems.list, { status: 'ARCHIVED' });
              Array.prototype.push.apply(contentItems, items);
            })
          );
    } catch (e) {
      console.log(
        `Fatal error: could not retrieve content items to unarchive. Is your repo ID correct? Error: \n${e.toString()}`
      );
      return;
    }

    if (revertLog != null) {
      try {
        const log = await new ArchiveLog().loadFromFile(revertLog);
        const ids = log.getData('ARCHIVE');
        contentItems = contentItems.filter(contentItem => ids.indexOf(contentItem.id || '') != -1);
        if (contentItems.length != ids.length) {
          missingContent = true;
        }
      } catch (e) {
        console.log(`Fatal error - could not read archive log. Error: \n${e.toString()}`);
        return;
      }
    } else if (name != null) {
      const itemsArray: string[] = Array.isArray(name) ? name : [name];
      contentItems = contentItems.filter(item => itemsArray.findIndex(id => equalsOrRegex(item.label || '', id)) != -1);
    } else if (contentType != null) {
      const itemsArray: string[] = Array.isArray(contentType) ? contentType : [contentType];
      contentItems = contentItems.filter(item => {
        if (item && item.body && item.body._meta) {
          return itemsArray.findIndex(id => equalsOrRegex(item.body._meta.schema, id)) != -1;
        }
      });
    } else {
      console.log('No filter, ID or log file was given, so unarchiving all content.');
      allContent = true;
    }
  }

  if (contentItems.length == 0) {
    console.log('Nothing found to unarchive, aborting.');
    return;
  }

  console.log('The following content items will be unarchived:');
  contentItems.forEach(contentItem => {
    console.log(` ${contentItem.label} (${contentItem.id})`);
  });
  console.log(`Total: ${contentItems.length}`);

  if (!force) {
    const yes = await confirmArchive('unarchive', 'content item', allContent, missingContent);
    if (!yes) {
      return;
    }
  }

  const timestamp = Date.now().toString();
  const log = new ArchiveLog(`Content Items Unarchive Log - ${timestamp}\n`);

  let successCount = 0;

  for (let i = 0; i < contentItems.length; i++) {
    try {
      await contentItems[i].related.unarchive();

      log.addAction('UNARCHIVE', `${contentItems[i].id}\n`);
      successCount++;
    } catch (e) {
      log.addComment(`UNARCHIVE FAILED: ${contentItems[i].id}`);
      log.addComment(e.toString());

      if (ignoreError) {
        console.log(
          `Failed to unarchive ${contentItems[i].label} (${contentItems[i].id}), continuing. Error: \n${e.toString()}`
        );
      } else {
        console.log(
          `Failed to unarchive ${contentItems[i].label} (${contentItems[i].id}), aborting. Error: \n${e.toString()}`
        );
        break;
      }
    }
  }

  if (!silent && logFile) {
    await log.writeToFile(logFile.replace('<DATE>', timestamp));
  }

  console.log(`Unarchived ${successCount} content items.`);
};

// log format:
// UNARCHIVE <content item id>
