import { builder, command, handler, LOG_FILENAME } from './unarchive';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import { ContentRepository, ContentItem, Folder } from 'dc-management-sdk-js';
import Yargs from 'yargs/yargs';
import readline from 'readline';
import MockPage from '../../common/dc-management-sdk-js/mock-page';
import { dirname } from 'path';
import { promisify } from 'util';
import { exists, readFile, unlink, mkdir, writeFile } from 'fs';

jest.mock('readline');

jest.mock('../../services/dynamic-content-client-factory');

describe('content-item unarchive command', () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  it('should command should defined', function() {
    expect(command).toEqual('unarchive [id]');
  });

  describe('builder tests', function() {
    it('should configure yargs', function() {
      const argv = Yargs(process.argv.slice(2));
      const spyPositional = jest.spyOn(argv, 'positional').mockReturnThis();
      const spyOption = jest.spyOn(argv, 'option').mockReturnThis();

      builder(argv);

      expect(spyPositional).toHaveBeenCalledWith('id', {
        type: 'string',
        describe:
          'The ID of a content item to be unarchived. If id is not provided, this command will unarchive ALL content items through all content repositories in the hub.'
      });

      expect(spyOption).toHaveBeenCalledWith('repoId', {
        type: 'string',
        describe: 'The ID of a content repository to search items in to be unarchived.',
        requiresArg: false
      });

      expect(spyOption).toHaveBeenCalledWith('folderId', {
        type: 'string',
        describe: 'The ID of a folder to search items in to be unarchived.',
        requiresArg: false
      });

      expect(spyOption).toHaveBeenCalledWith('name', {
        type: 'string',
        describe:
          'The name of a Content Item to be unarchived.\nA regex can be provided to select multiple items with similar or matching names (eg /.header/).\nA single --name option may be given to match a single content item pattern.\nMultiple --name options may be given to match multiple content items patterns at the same time, or even multiple regex.'
      });

      expect(spyOption).toHaveBeenCalledWith('contentType', {
        type: 'string',
        describe:
          'The ID of a Content type to unarchive all content items.\nA single --contentType option may be given to match a single content type pattern.\nMultiple --contentType options may be given to match multiple content type patterns at the same time.'
      });

      expect(spyOption).toHaveBeenCalledWith('revertLog', {
        type: 'string',
        describe:
          'Path to a log file containing content items archived in a previous run of the archive command.\nWhen provided, unarchives all content items listed as ARCHIVE in the log file.',
        requiresArg: false
      });

      expect(spyOption).toHaveBeenCalledWith('f', {
        type: 'boolean',
        boolean: true,
        describe: 'If present, there will be no confirmation prompt before unarchiving the found content.'
      });

      expect(spyOption).toHaveBeenCalledWith('s', {
        type: 'boolean',
        boolean: true,
        describe: 'If present, no log file will be produced.'
      });

      expect(spyOption).toHaveBeenCalledWith('ignoreError', {
        type: 'boolean',
        boolean: true,
        describe: 'If present, unarchive requests that fail will not abort the process.'
      });

      expect(spyOption).toHaveBeenCalledWith('logFile', {
        type: 'string',
        default: LOG_FILENAME,
        describe: 'Path to a log file to write to.'
      });
    });
  });

  describe('handler tests', function() {
    const yargArgs = {
      $0: 'test',
      _: ['test'],
      json: true
    };
    const config = {
      clientId: 'client-id',
      clientSecret: 'client-id',
      hubId: 'hub-id'
    };

    const mockValues = (unarchiveError = false) => {
      const mockGet = jest.fn();
      const mockGetList = jest.fn();
      const mockItemsList = jest.fn();
      const mockUnarchive = jest.fn();
      const mockItemGetById = jest.fn();
      const mockRepoGet = jest.fn();
      const mockFolderGet = jest.fn();

      (dynamicContentClientFactory as jest.Mock).mockReturnValue({
        hubs: {
          get: mockGet
        },
        contentRepositories: {
          get: mockRepoGet
        },
        contentItems: {
          get: mockItemGetById
        },
        folders: {
          get: mockFolderGet
        }
      });

      mockFolderGet.mockResolvedValue(
        new Folder({
          name: 'folder1',
          id: 'folder1',
          client: {
            fetchLinkedResource: mockItemsList
          },
          _links: {
            'content-items': {
              href:
                'https://api.amplience.net/v2/content/content-repositories/repo1/content-items{?folderId,page,projection,size,sort,status}',
              templated: true
            }
          },
          related: {
            contentItems: {
              list: mockItemsList
            }
          }
        })
      );

      mockGet.mockResolvedValue({
        id: 'hub-id',
        related: {
          contentRepositories: {
            list: mockGetList
          }
        }
      });

      mockGetList.mockResolvedValue(
        new MockPage(ContentRepository, [
          new ContentRepository({
            name: 'repo1',
            client: {
              fetchLinkedResource: mockItemsList
            },
            _links: {
              'content-items': {
                href:
                  'https://api.amplience.net/v2/content/content-repositories/repo1/content-items{?folderId,page,projection,size,sort,status}',
                templated: true
              }
            },
            related: {
              contentItems: {
                list: mockItemsList
              }
            }
          })
        ])
      );

      mockRepoGet.mockResolvedValue(
        new ContentRepository({
          name: 'repo1',
          client: {
            fetchLinkedResource: mockItemsList
          },
          _links: {
            'content-items': {
              href:
                'https://api.amplience.net/v2/content/content-repositories/repo1/content-items{?folderId,page,projection,size,sort,status}',
              templated: true
            }
          },
          related: {
            contentItems: {
              list: mockItemsList
            }
          }
        })
      );

      mockItemGetById.mockResolvedValue(
        new ContentItem({
          id: '1',
          label: 'item1',
          repoId: 'repo1',
          folderId: 'folder1',
          status: 'ARCHIVED',
          body: {
            _meta: {
              schema: 'http://test.com'
            }
          },
          related: { unarchive: mockUnarchive },
          client: {
            performActionThatReturnsResource: mockUnarchive
          },
          _links: {
            unarchive: {
              href: 'https://api.amplience.net/v2/content/content-items/1/unarchive'
            }
          }
        })
      );

      mockItemsList.mockResolvedValue(
        new MockPage(ContentItem, [
          new ContentItem({
            id: '1',
            label: 'item1',
            repoId: 'repo1',
            folderId: 'folder1',
            status: 'ARCHIVED',
            body: {
              _meta: {
                schema: 'http://test.com'
              }
            },
            related: { unarchive: mockUnarchive },
            client: {
              performActionThatReturnsResource: mockUnarchive
            },
            _links: {
              unarchive: {
                href: 'https://api.amplience.net/v2/content/content-items/1/unarchive'
              }
            }
          }),
          new ContentItem({
            id: '2',
            label: 'item2',
            repoId: 'repo1',
            folderId: 'folder1',
            status: 'ARCHIVED',
            body: {
              _meta: {
                schema: 'http://test1.com'
              }
            },
            client: {
              performActionThatReturnsResource: mockUnarchive
            },
            _links: {
              unarchive: {
                href: 'https://api.amplience.net/v2/content/content-items/2/unarchive'
              }
            },
            related: { unarchive: mockUnarchive }
          })
        ])
      );

      if (unarchiveError) {
        mockUnarchive.mockRejectedValue(new Error('Error'));
        mockFolderGet.mockRejectedValue(new Error('Error'));
        mockItemGetById.mockRejectedValue(new Error('Error'));
      }

      return {
        mockGet,
        mockGetList,
        mockItemsList,
        mockUnarchive,
        mockItemGetById,
        mockRepoGet,
        mockFolderGet
      };
    };

    it('should unarchive all content', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockItemsList, mockUnarchive } = mockValues();

      const argv = {
        ...yargArgs,
        ...config
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalledTimes(2);
    });

    it('should unarchive content by id', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockUnarchive, mockItemGetById } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        id: '1',
        repoId: 'repo123'
      };
      await handler(argv);

      expect(mockItemGetById).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalledTimes(1);
    });

    it("shouldn't archive content by id", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockUnarchive, mockItemGetById } = mockValues(true);

      const argv = {
        ...yargArgs,
        ...config,
        id: '1'
      };
      await handler(argv);

      expect(mockItemGetById).toHaveBeenCalled();
      expect(mockUnarchive).not.toBeCalled();
    });

    it('should unarchive content by repo id', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockUnarchive, mockRepoGet } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        repoId: 'repo1'
      };
      await handler(argv);

      expect(mockRepoGet).toBeCalledTimes(1);
      expect(mockUnarchive).toBeCalledTimes(2);
    });

    it('should unarchive content by repo ids', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockUnarchive, mockRepoGet } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        repoId: ['repo1', 'repo2']
      };
      await handler(argv);

      expect(mockRepoGet).toBeCalledTimes(2);
      expect(mockUnarchive).toBeCalledTimes(4);
    });

    it('should unarchive content by folder id', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockUnarchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        folderId: 'folder1',
        repoId: 'repo123'
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(1);
      expect(mockItemsList).toBeCalledTimes(1);
      expect(mockUnarchive).toBeCalledTimes(2);
    });

    it('should unarchive content by folder ids', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockUnarchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        folderId: ['folder1', 'folder1']
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(2);
      expect(mockItemsList).toBeCalledTimes(2);
      expect(mockUnarchive).toBeCalledTimes(4);
    });

    it('should unarchive content by name', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockUnarchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        folderId: 'folder1',
        name: 'item1'
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(1);
      expect(mockItemsList).toBeCalledTimes(1);
      expect(mockUnarchive).toBeCalledTimes(1);
    });

    it('should exit when both name and id are presented', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockUnarchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        id: '123',
        name: 'item1'
      };
      await handler(argv);

      expect(mockFolderGet).not.toBeCalled();
      expect(mockItemsList).not.toBeCalled();
      expect(mockUnarchive).not.toBeCalled();
    });

    it("shouldn't unarchive content by name", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockUnarchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        folderId: 'folder1',
        name: ['item3']
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(1);
      expect(mockItemsList).toBeCalledTimes(1);
      expect(mockUnarchive).not.toBeCalled();
    });

    it("shouldn't unarchive content, answer no", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['n']);

      const { mockUnarchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        folderId: 'folder1',
        name: 'item1'
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(1);
      expect(mockItemsList).toBeCalledTimes(1);
      expect(mockUnarchive).not.toBeCalled();
    });

    it('should unarchive content by name regexp', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockUnarchive, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        name: '/item/'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalledTimes(2);
    });

    it('should unarchive content by content type name', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockUnarchive, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        contentType: 'http://test.com'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalledTimes(1);
    });

    it('should unarchive content by content type regexp', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockUnarchive, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        contentType: '/test/'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalledTimes(2);
    });

    it('should unarchive content by content type regexp', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockUnarchive, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        contentType: '/test123/'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalledTimes(0);
    });

    it('should unarchive content with ignoreError', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockUnarchive, mockItemsList } = mockValues(true);

      const argv = {
        ...yargArgs,
        ...config,
        ignoreError: true
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalledTimes(2);
    });

    it("shouldn't unarchive content with ignoreError", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockUnarchive, mockItemsList } = mockValues(true);

      const argv = {
        ...yargArgs,
        ...config,
        ignoreError: false
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalledTimes(1);
    });

    it('should unarchive content items without asking if --force is provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['input', 'ignored']);

      const { mockGet, mockGetList, mockUnarchive, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        force: true
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalledTimes(2);
    });

    it('should unarchive content items specified in the provided --revertLog', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const logFileName = 'temp/content-item-archive.log';
      const log = '// Type log test file\n' + 'ARCHIVE 1\n' + 'ARCHIVE 2\n' + 'ARCHIVE idMissing';

      const dir = dirname(logFileName);
      if (!(await promisify(exists)(dir))) {
        await promisify(mkdir)(dir);
      }
      await promisify(writeFile)(logFileName, log);

      const { mockGet, mockGetList, mockUnarchive, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        logFile: LOG_FILENAME(),
        silent: true,
        force: true,
        revertLog: logFileName
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalledTimes(2);
    });

    it("shouldn't unarchive content items, getFolder error", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['input', 'ignored']);

      const { mockFolderGet, mockUnarchive, mockItemsList } = mockValues(true);

      const argv = {
        ...yargArgs,
        ...config,
        folderId: 'folder1'
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(1);
      expect(mockItemsList).not.toBeCalled();
      expect(mockUnarchive).not.toBeCalled();
    });

    it("shouldn't unarchive content items, revertLog error", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      if (await promisify(exists)('temp/content-item-archive.log')) {
        await promisify(unlink)('temp/content-item-archive.log');
      }

      const logFileName = 'temp/content-item-archive.log';
      const log = '// Type log test file\n' + 'ARCHIVE 1\n' + 'ARCHIVE 2\n' + 'ARCHIVE idMissing';

      const dir = dirname(logFileName);
      if (!(await promisify(exists)(dir))) {
        await promisify(mkdir)(dir);
      }
      await promisify(writeFile)(logFileName, log);

      const { mockGet, mockGetList, mockUnarchive, mockItemsList } = mockValues(true);

      const argv = {
        ...yargArgs,
        ...config,
        logFile: LOG_FILENAME(),
        silent: true,
        force: true,
        revertLog: 'wrongFileName.log'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockUnarchive).not.toBeCalled();
    });

    it('should unarchive content items, write log file', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      if (await promisify(exists)('temp/content-item-unarchive.log')) {
        await promisify(unlink)('temp/content-item-unarchive.log');
      }

      const { mockItemGetById, mockUnarchive } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        logFile: 'temp/content-item-unarchive.log',
        id: '1'
      };

      await handler(argv);

      expect(mockItemGetById).toHaveBeenCalled();
      expect(mockUnarchive).toBeCalled();

      const logExists = await promisify(exists)('temp/content-item-unarchive.log');

      expect(logExists).toBeTruthy();

      const log = await promisify(readFile)('temp/content-item-unarchive.log', 'utf8');

      const logLines = log.split('\n');
      let total = 0;
      logLines.forEach(line => {
        if (line.indexOf('UNARCHIVE') !== -1) {
          total++;
        }
      });

      expect(total).toEqual(1);

      await promisify(unlink)('temp/content-item-unarchive.log');
    });
  });
});
