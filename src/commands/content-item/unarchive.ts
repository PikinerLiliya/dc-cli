import { Arguments, Argv } from 'yargs';
import { ConfigurationParameters } from '../configure';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import { ArchiveLog } from '../../common/archive/archive-log';
import paginator from '../../common/dc-management-sdk-js/paginator';
import { getDefaultLogPath, confirmArchive } from '../../common/archive/archive-helpers';
import ArchiveOptions from '../../common/archive/archive-options';
import { ContentItem, ContentRepository } from 'dc-management-sdk-js';

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
    .option('repo', {
      type: 'string',
      describe: 'The ID of a content repository to search items in to be unarchived.',
      requiresArg: false
    })
    .option('folder', {
      type: 'string',
      describe: 'The ID of a folder to search items in to be archived.',
      requiresArg: false
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
  const { id, logFile, force, silent, ignoreError, hubId, revertLog, repo, folder } = argv;
  const client = dynamicContentClientFactory(argv);

  let contentItems: ContentItem[] = [];
  let contentRepositories: ContentRepository[];
  let allContent = false;
  let missingContent = false;

  if (repo && id) {
    console.log('ID of content item is specified, ignoring repository ID');
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
        const currentFolder = await client.folders.get(folder);

        contentItems = await paginator(currentFolder.related.contentItems.list, { status: 'ARCHIVED' });
      } else if (repo) {
        const repository = await client.contentRepositories.get(repo);

        contentItems = await paginator(repository.related.contentItems.list, { status: 'ARCHIVED' });
      } else {
        const hub = await client.hubs.get(hubId);
        contentRepositories = await paginator(hub.related.contentRepositories.list);

        await Promise.all(
          contentRepositories.map(async contentRepository => {
            const items = await paginator(contentRepository.related.contentItems.list, { status: 'ARCHIVED' });
            contentItems = contentItems.concat(items);
          })
        );
      }
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

  if (!silent) {
    await log.writeToFile(logFile.replace('<DATE>', timestamp));
  }

  console.log(`Unarchived ${successCount} content items.`);
};

// log format:
// UNARCHIVE <content item id>
