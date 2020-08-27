import { Arguments, Argv } from 'yargs';
import { ConfigurationParameters } from '../configure';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import { FileLog } from '../../common/file-log';
import { dirname, join } from 'path';
import { equalsOrRegex } from '../../common/filter/filter';
import sanitize from 'sanitize-filename';
import { uniqueFilenamePath, writeJsonToFile } from '../../services/export.service';

import { mkdir, writeFile, exists, lstat } from 'fs';
import { promisify } from 'util';
import { ExportItemBuilderOptions } from '../../interfaces/export-item-builder-options.interface';
import paginator from '../../common/dc-management-sdk-js/paginator';
import { ContentItem, Folder, DynamicContent, Hub, ContentRepository } from 'dc-management-sdk-js';

import { ensureDirectoryExists } from '../../common/import/directory-utils';
import { ContentDependancyTree } from '../../common/content-item/content-dependancy-tree';
import { ContentMapping } from '../../common/content-item/content-mapping';
import { getDefaultLogPath } from '../../common/log-helpers';
import { AmplienceSchemaValidator } from '../../common/content-item/amplience-schema-validator';

export const command = 'export <dir>';

export const desc = 'Export Content Items';

export const LOG_FILENAME = (platform: string = process.platform): string =>
  getDefaultLogPath('item', 'export', platform);

export const builder = (yargs: Argv): void => {
  yargs
    .positional('dir', {
      describe: 'Output directory for the exported Content Items',
      type: 'string',
      requiresArg: true
    })
    .option('repoId', {
      type: 'string',
      describe:
        'Export content from within a given repository. Directory structure will start at the specified repository. Will automatically export all contained folders.'
    })
    .option('folderId', {
      type: 'string',
      describe:
        'Export content from within a given folder. Directory structure will start at the specified folder. Can be used in addition to repoId.'
    })
    .option('schemaId', {
      type: 'string',
      describe:
        'Export content with a given or matching Schema ID. A regex can be provided, surrounded with forward slashes. Can be used in combination with other filters.'
    })
    .option('name', {
      type: 'string',
      describe:
        'Export content with a given or matching Name. A regex can be provided, surrounded with forward slashes. Can be used in combination with other filters.'
    })
    .option('logFile', {
      type: 'string',
      default: LOG_FILENAME,
      describe: 'Path to a log file to write to.'
    });
};

const getOrAddFolderPath = async (
  folderToPathMap: Map<string, string>,
  client: DynamicContent,
  folderOrId: Folder | string | undefined,
  log: FileLog,
  baseDir?: string
): Promise<string> => {
  if (folderOrId == null) return '';
  const id = typeof folderOrId === 'string' ? folderOrId : (folderOrId.id as string);

  const mapResult = folderToPathMap.get(id);
  if (mapResult !== undefined) {
    return mapResult;
  }

  // Build the path for this folder.
  const folder = typeof folderOrId === 'string' ? await client.folders.get(folderOrId) : folderOrId;

  const name = sanitize(folder.name as string);
  let path: string;
  try {
    const parent = await folder.related.folders.parent();

    path = `${join(await getOrAddFolderPath(folderToPathMap, client, parent, log), name)}`;
  } catch {
    log.appendLine(`Could not determine path for ${folder.name}. Placing in base directory.`);
    path = `${name}`;
  }

  if (baseDir != null) {
    path = join(baseDir, path);
  }

  folderToPathMap.set(id, path);
  return path;
};

const getContentItems = async (
  folderToPathMap: Map<string, string>,
  client: DynamicContent,
  hub: Hub,
  dir: string,
  log: FileLog,
  repoId?: string | string[],
  folderId?: string | string[]
): Promise<{ path: string; item: ContentItem }[]> => {
  const items: { path: string; item: ContentItem }[] = [];

  const folderIds = typeof folderId === 'string' ? [folderId] : folderId || [];

  const repoItems: ContentItem[] = [];

  const repoIds = typeof repoId === 'string' ? [repoId] : repoId || [];

  const repositories = await (repoId != null || folderId != null
    ? Promise.all(repoIds.map(id => client.contentRepositories.get(id)))
    : paginator(hub.related.contentRepositories.list));

  let specifyBasePaths = repositories.length + folderIds.length > 1;

  for (let i = 0; i < repositories.length; i++) {
    const repository = repositories[i];
    const baseDir = specifyBasePaths ? `${sanitize(repository.label as string)}/` : '';
    await ensureDirectoryExists(join(dir, baseDir));
    const newFolders = await paginator(repository.related.folders.list);
    newFolders.forEach(folder => {
      if (folderIds.indexOf(folder.id as string) === -1) {
        folderIds.push(folder.id as string);
      }
      folderToPathMap.set(folder.id as string, join(baseDir, `${sanitize(folder.name as string)}/`));
    });

    // Add content items in repo base folder. Cache the other items so we don't have to request them again.
    let newItems: ContentItem[];
    try {
      const allItems = await paginator(repository.related.contentItems.list, { status: 'ACTIVE' });
      Array.prototype.push.apply(repoItems, allItems);
      newItems = allItems.filter(item => item.folderId == null);
    } catch (e) {
      console.error(`Error getting items from repository ${repository.name} (${repository.id}): ${e.toString()}`);
      continue;
    }

    Array.prototype.push.apply(items, newItems.map(item => ({ item, path: baseDir })));
  }

  const parallelism = 10;
  const folders = await Promise.all(folderIds.map(id => client.folders.get(id)));
  log.appendLine(`Found ${folders.length} base folders.`);

  specifyBasePaths = specifyBasePaths || folders.length > 1;

  const nextFolders: Folder[] = [];
  let processFolders = folders;
  let baseFolder = true;

  while (processFolders.length > 0) {
    const promises = processFolders.map(
      async (folder: Folder): Promise<void> => {
        if (baseFolder) {
          if (!folderToPathMap.has(folder.id as string)) {
            folderToPathMap.set(folder.id as string, specifyBasePaths ? `${sanitize(folder.name as string)}/` : '');
          }
        }
        const path = await getOrAddFolderPath(folderToPathMap, client, folder, log);
        log.appendLine(`Processing ${path}...`);

        let newItems: ContentItem[];
        // If we already have seen items in this folder, use those. Otherwise try get them explicitly.
        // This may happen for folders in selected repositories if they are empty, but it will be a no-op (and is unavoidable).
        newItems = repoItems.filter(item => item.folderId == folder.id);
        if (newItems.length == 0) {
          log.appendLine(`Fetching additional folder: ${folder.name}`);
          try {
            newItems = (await paginator(folder.related.contentItems.list)).filter(item => item.status === 'ACTIVE');
          } catch (e) {
            console.error(`Error getting items from folder ${folder.name} (${folder.id}): ${e.toString()}`);
            return;
          }
        }
        Array.prototype.push.apply(items, newItems.map(item => ({ item, path: path })));

        try {
          const subfolders = await paginator(folder.related.folders.list);
          Array.prototype.push.apply(nextFolders, subfolders);
        } catch (e) {
          console.error(`Error getting subfolders from folder ${folder.name} (${folder.id}): ${e.toString()}`);
        }
      }
    );

    await Promise.all(promises);

    baseFolder = false;
    processFolders = nextFolders.splice(0, Math.min(nextFolders.length, parallelism));
  }
  return items;
};

export const handler = async (argv: Arguments<ExportItemBuilderOptions & ConfigurationParameters>): Promise<void> => {
  const { dir, repoId, folderId, schemaId, name, logFile } = argv;

  const dummyRepo = new ContentRepository();

  const folderToPathMap: Map<string, string> = new Map();
  const client = dynamicContentClientFactory(argv);
  const log = typeof logFile === 'string' || logFile == null ? new FileLog(logFile) : logFile;
  const hub = await client.hubs.get(argv.hubId);

  log.appendLine('Retrieving content items, please wait.');
  let items = await getContentItems(folderToPathMap, client, hub, dir, log, repoId, folderId);

  // Filter using the schemaId and name, if present.
  if (schemaId != null) {
    const schemaIds: string[] = Array.isArray(schemaId) ? schemaId : [schemaId];
    items = items.filter(
      ({ item }: { item: ContentItem }) => schemaIds.findIndex(id => equalsOrRegex(item.body._meta.schema, id)) !== -1
    );
  }
  if (name != null) {
    const names: string[] = Array.isArray(name) ? name : [name];
    items = items.filter(
      ({ item }: { item: ContentItem }) => names.findIndex(name => equalsOrRegex(item.label as string, name)) !== -1
    );
  }

  log.appendLine('Scanning for dependancies.');
  const tree = new ContentDependancyTree(
    items.map(item => ({ repo: dummyRepo, content: item.item })),
    new ContentMapping()
  );

  const missingIDs = new Set<string>();
  const invalidContentItems = tree.filterAny(item => {
    const missingDeps = item.dependancies.filter(dep => !tree.byId.has(dep.dependancy.id as string));
    missingDeps.forEach(dep => {
      if (dep.dependancy.id != null) {
        missingIDs.add(dep.dependancy.id);
      }
    });
    return missingDeps.length > 0;
  });

  if (invalidContentItems) {
    // There are missing content items. We'll need to fetch them and see what their deal is.
    const missingIdArray = Array.from(missingIDs);
    for (let i = 0; i < missingIdArray.length; i++) {
      let item: ContentItem | null = null;

      try {
        item = await client.contentItems.get(missingIdArray[i]);
      } catch {}

      if (item != null) {
        if (item.status === 'ACTIVE') {
          // The item is active and should probably be included.
          const path = '_dependancies/';
          items.push({ item, path });

          log.appendLine(`Referenced content '${item.label}' added to the export.`);
        } else {
          // The item is archived and should not be included. Make a note to the user.
          log.appendLine(`Referenced content '${item.label}' is archived, so was not exported.`);
        }
      } else {
        log.appendLine(`Referenced content ${missingIdArray[i]} does not exist.`);
      }
    }
  }

  log.appendLine('Saving content items.');
  const filenames: string[] = [];

  const schemas = await paginator(hub.related.contentTypeSchema.list);

  const validator = new AmplienceSchemaValidator(schemas);

  for (let i = 0; i < items.length; i++) {
    const { item, path } = items[i];

    try {
      const errors = await validator.validate(item.body);
      if (errors.length > 0) {
        log.appendLine(
          `WARNING: ${item.label} does not validate under the available schema. It may not import correctly.`
        );
        log.appendLine(JSON.stringify(errors, null, 2));
      }
    } catch (e) {
      log.appendLine(`WARNING: Could not validate ${item.label} as there is a problem with the schema: ${e}`);
    }

    let resolvedPath: string;
    resolvedPath = path;

    const directory = join(dir, resolvedPath);
    resolvedPath = uniqueFilenamePath(directory, `${sanitize(item.label as string)}`, 'json', filenames);
    filenames.push(resolvedPath);
    log.appendLine(resolvedPath);
    await ensureDirectoryExists(directory);

    writeJsonToFile(resolvedPath, item);
  }

  log.close();
};
