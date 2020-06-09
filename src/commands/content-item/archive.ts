import { Arguments, Argv } from 'yargs';
import { ConfigurationParameters } from '../configure';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import { ArchiveLog } from '../../common/archive/archive-log';
import paginator from '../../common/dc-management-sdk-js/paginator';
import { getDefaultLogPath, confirmArchive } from '../../common/archive/archive-helpers';
import ArchiveOptions from '../../common/archive/archive-options';
import { ContentItem, ContentRepository } from 'dc-management-sdk-js';
import { equalsOrRegex } from '../../common/filter/filter';

export const command = 'archive [id]';

export const desc = 'Archive Content Items';

export const LOG_FILENAME = (platform: string = process.platform): string =>
  getDefaultLogPath('content-item', 'archive', platform);

export const builder = (yargs: Argv): void => {
  yargs
    .positional('id', {
      type: 'string',
      describe:
        'The ID of a content item to be archived. If id is not provided, this command will archive ALL content items through all content repositories in the hub.'
    })
    .option('repo', {
      type: 'string',
      describe: 'The ID of a content repository to search items in to be archived.',
      requiresArg: false
    })
    .option('folder', {
      type: 'string',
      describe: 'The ID of a folder to search items in to be archived.',
      requiresArg: false
    })
    .option('name', {
      type: 'string',
      describe:
        'The name of a Content Item to be archived.\nA regex can be provided to select multiple items with similar or matching names (eg /.header/).\nA single --name option may be given to match a single content item pattern.\nMultiple --name options may be given to match multiple content items patterns at the same time, or even multiple regex.'
    })
    .option('contentType', {
      type: 'string',
      describe:
        'The ID of a Content type to archive all content items.\nA single --contentType option may be given to match a single content type pattern.\nMultiple --contentType options may be given to match multiple content type patterns at the same time.'
    })
    .option('revertLog', {
      type: 'string',
      describe:
        'Path to a log file containing content items unarchived in a previous run of the unarchive command.\nWhen provided, archives all content items listed as UNARCHIVE in the log file.',
      requiresArg: false
    })
    .alias('f', 'force')
    .option('f', {
      type: 'boolean',
      boolean: true,
      describe: 'If present, there will be no confirmation prompt before archiving the found content.'
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
      describe: 'If present, archive requests that fail will not abort the process.'
    })
    .option('logFile', {
      type: 'string',
      default: LOG_FILENAME,
      describe: 'Path to a log file to write to.'
    });
};

export const handler = async (argv: Arguments<ArchiveOptions & ConfigurationParameters>): Promise<void> => {
  const { id, logFile, force, silent, ignoreError, hubId, revertLog, repo, folder, name, contentType } = argv;
  const client = dynamicContentClientFactory(argv);

  let contentItems: ContentItem[] = [];
  let allContent = false;
  let missingContent = false;

  if (repo && id) {
    console.log('ID of content item is specified, ignoring repository ID');
  }

  if (id && name) {
    console.log('Please specify either a item name or an ID - not both.');
    return;
  }

  if (repo && folder) {
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
      if (folder) {
        try {
          const currentFolder = await client.folders.get(folder);

          contentItems = await paginator(currentFolder.related.contentItems.list, { status: 'ACTIVE' });
        } catch (e) {
          console.log('1', e);
        }
      } else if (repo) {
        try {
          const repository = await client.contentRepositories.get(repo);

          contentItems = await paginator(repository.related.contentItems.list, { status: 'ACTIVE' });
        } catch (e) {
          console.log('2', e);
        }
      } else {
        try {
          const hub = await client.hubs.get(hubId);
          const contentRepositories = await paginator(hub.related.contentRepositories.list);

          await Promise.all(
            contentRepositories.map(async contentRepository => {
              const items = await paginator(contentRepository.related.contentItems.list, { status: 'ACTIVE' });
              contentItems = contentItems.concat(items);
            })
          );
        } catch (e) {
          console.log('3', e);
        }
      }
    } catch (e) {
      console.log(
        `Fatal error: could not retrieve content items to archive. Is your repo ID correct? Error: \n${e.toString()}`
      );
      return;
    }

    if (revertLog != null) {
      try {
        const log = await new ArchiveLog().loadFromFile(revertLog);
        const ids = log.getData('UNARCHIVE');
        contentItems = contentItems.filter(contentItem => ids.indexOf(contentItem.id || '') != -1);
        if (contentItems.length != ids.length) {
          missingContent = true;
        }
      } catch (e) {
        console.log(`Fatal error - could not read unarchive log. Error: \n${e.toString()}`);
        return;
      }
    } else if (name != null) {
      const itemsArray: string[] = Array.isArray(name) ? name : [name];
      contentItems = contentItems.filter(item => itemsArray.findIndex(id => equalsOrRegex(item.label || '', id)) != -1);
    } else if (contentType != null) {
      const itemsArray: string[] = Array.isArray(contentType) ? contentType : [contentType];
      contentItems = contentItems.filter(item => {
        if (item && item.body && item.body._meta) {
          return itemsArray.findIndex(id => equalsOrRegex(item.body._meta.schema || '', id)) != -1;
        }
      });
    } else {
      console.log('No filter, ID or log file was given, so archiving all content.');
      allContent = true;
    }
  }

  if (contentItems.length == 0) {
    console.log('Nothing found to archive, aborting.');
    return;
  }

  console.log('The following content items will be archived:');
  contentItems.forEach(contentItem => {
    // console.log(` ${contentItem.label} (${contentItem.id})`);
  });
  console.log(`Total: ${contentItems.length}`);

  if (!force) {
    const yes = await confirmArchive('archive', 'content item', allContent, missingContent);
    if (!yes) {
      return;
    }
  }

  const timestamp = Date.now().toString();
  const log = new ArchiveLog(`Content Items Archive Log - ${timestamp}\n`);

  let successCount = 0;

  for (let i = 0; i < contentItems.length; i++) {
    try {
      await contentItems[i].related.archive();

      log.addAction('ARCHIVE', `${contentItems[i].id}\n`);
      successCount++;
    } catch (e) {
      log.addComment(`ARCHIVE FAILED: ${contentItems[i].id}`);
      log.addComment(e.toString());

      if (ignoreError) {
        console.log(
          `Failed to archive ${contentItems[i].label} (${contentItems[i].id}), continuing. Error: \n${e.toString()}`
        );
      } else {
        console.log(
          `Failed to archive ${contentItems[i].label} (${contentItems[i].id}), aborting. Error: \n${e.toString()}`
        );
        break;
      }
    }
  }

  if (!silent) {
    await log.writeToFile(logFile.replace('<DATE>', timestamp));
  }

  console.log(`Archived ${successCount} content items.`);
};

// log format:
// ARCHIVE <content item id>
