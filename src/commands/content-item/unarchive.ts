import { Arguments, Argv } from 'yargs';
import { ConfigurationParameters } from '../configure';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import { ArchiveLog } from '../../common/archive/archive-log';
import paginator from '../../common/dc-management-sdk-js/paginator';
import { getDefaultLogPath, confirmArchive } from '../../common/archive/archive-helpers';
import ArchiveOptions from '../../common/archive/archive-options';
import { ContentItem, ContentRepository } from 'dc-management-sdk-js';

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
      describe:
        'The ID of a content repository to search items in to be archived.',
      requiresArg: false
    })
    .option('revertLog', {
      type: 'string',
      describe:
        'Path to a log file containing content items unarchived in a previous run of the unarchive command.\nWhen provided, archives all content items listed as unarchived in the log file.',
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
  const { id, logFile, force, silent, ignoreError, hubId, revertLog, repo } = argv;
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
      const hub = await client.hubs.get(hubId);
      contentRepositories = await paginator(hub.related.contentRepositories.list);

      await Promise.all(contentRepositories.map(async (contentRepository) => {
        const items = await paginator(contentRepository.related.contentItems.list);
        contentItems = contentItems.concat(items);
      }));
    } catch (e) {
      console.log(
        `Fatal error: could not retrieve content type schemas to archive. Is your hub correct? Error: \n${e.toString()}`
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
    console.log(` ${contentItem.label}(${contentItem.id})`);
  });

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
        console.log(`Failed to archive ${contentItems[i].label}(${contentItems[i].id}), continuing. Error: \n${e.toString()}`);
      } else {
        console.log(`Failed to archive ${contentItems[i].label}(${contentItems[i].id}), aborting. Error: \n${e.toString()}`);
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
