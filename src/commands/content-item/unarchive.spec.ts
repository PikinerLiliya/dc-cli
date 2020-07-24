import { builder, command, handler, LOG_FILENAME } from './archive';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import { ContentRepository, ContentItem, Folder } from 'dc-management-sdk-js';
import Yargs from 'yargs/yargs';
import readline from 'readline';
import MockPage from '../../common/dc-management-sdk-js/mock-page';

jest.mock('readline');

jest.mock('../../services/dynamic-content-client-factory');

describe('content-item archive command', () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  it('should command should defined', function() {
    expect(command).toEqual('archive [id]');
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
          'The ID of a content item to be archived. If id is not provided, this command will archive ALL content items through all content repositories in the hub.'
      });

      expect(spyOption).toHaveBeenCalledWith('repoId', {
        type: 'string',
        describe: 'The ID of a content repository to search items in to be archived.',
        requiresArg: false
      });

      expect(spyOption).toHaveBeenCalledWith('folderId', {
        type: 'string',
        describe: 'The ID of a folder to search items in to be archived.',
        requiresArg: false
      });

      expect(spyOption).toHaveBeenCalledWith('name', {
        type: 'string',
        describe:
          'The name of a Content Item to be archived.\nA regex can be provided to select multiple items with similar or matching names (eg /.header/).\nA single --name option may be given to match a single content item pattern.\nMultiple --name options may be given to match multiple content items patterns at the same time, or even multiple regex.'
      });

      expect(spyOption).toHaveBeenCalledWith('contentType', {
        type: 'string',
        describe:
          'The ID of a Content type to archive all content items.\nA single --contentType option may be given to match a single content type pattern.\nMultiple --contentType options may be given to match multiple content type patterns at the same time.'
      });

      expect(spyOption).toHaveBeenCalledWith('revertLog', {
        type: 'string',
        describe:
          'Path to a log file containing content items unarchived in a previous run of the unarchive command.\nWhen provided, archives all content items listed as UNARCHIVE in the log file.',
        requiresArg: false
      });

      expect(spyOption).toHaveBeenCalledWith('f', {
        type: 'boolean',
        boolean: true,
        describe: 'If present, there will be no confirmation prompt before archiving the found content.'
      });

      expect(spyOption).toHaveBeenCalledWith('s', {
        type: 'boolean',
        boolean: true,
        describe: 'If present, no log file will be produced.'
      });

      expect(spyOption).toHaveBeenCalledWith('ignoreError', {
        type: 'boolean',
        boolean: true,
        describe: 'If present, archive requests that fail will not abort the process.'
      });

      expect(spyOption).toHaveBeenCalledWith('logFile', {
        type: 'string',
        default: LOG_FILENAME,
        describe: 'Path to a log file to write to.'
      });
    });
  });

  const mockValues = (archiveError = false) => {
    const mockGet = jest.fn();
    const mockGetList = jest.fn();
    const mockItemsList = jest.fn();
    const mockArchive = jest.fn();
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
        status: 'ACTIVE',
        body: {
          _meta: {
            schema: 'http://test.com'
          }
        },
        related: { archive: mockArchive },
        client: {
          performActionThatReturnsResource: mockArchive
        },
        _links: {
          archive: {
            href: 'https://api.amplience.net/v2/content/content-items/1/archive'
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
          status: 'ACTIVE',
          body: {
            _meta: {
              schema: 'http://test.com'
            }
          },
          related: { archive: mockArchive },
          client: {
            performActionThatReturnsResource: mockArchive
          },
          _links: {
            archive: {
              href: 'https://api.amplience.net/v2/content/content-items/1/archive'
            }
          }
        }),
        new ContentItem({
          id: '2',
          label: 'item2',
          repoId: 'repo1',
          folderId: 'folder1',
          status: 'ACTIVE',
          body: {
            _meta: {
              schema: 'http://test1.com'
            }
          },
          client: {
            performActionThatReturnsResource: mockArchive
          },
          _links: {
            archive: {
              href: 'https://api.amplience.net/v2/content/content-items/2/archive'
            }
          },
          related: { archive: mockArchive }
        })
      ])
    );

    if (archiveError) {
      mockArchive.mockRejectedValue(new Error('Error'));
    }

    return {
      mockGet,
      mockGetList,
      mockItemsList,
      mockArchive,
      mockItemGetById,
      mockRepoGet,
      mockFolderGet
    };
  };

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

    it('should archive all content', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockItemsList, mockArchive } = mockValues();

      const argv = {
        ...yargArgs,
        ...config
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockArchive).toBeCalledTimes(2);
    });

    it('should archive content by id', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockArchive, mockItemGetById } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        id: '1'
      };
      await handler(argv);

      expect(mockItemGetById).toHaveBeenCalled();
      expect(mockArchive).toBeCalledTimes(1);
    });

    it('should archive content by repo id', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockArchive, mockRepoGet } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        repoId: 'repo1'
      };
      await handler(argv);

      expect(mockRepoGet).toBeCalledTimes(1);
      expect(mockArchive).toBeCalledTimes(2);
    });

    it('should archive content by repo ids', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockArchive, mockRepoGet } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        repoId: ['repo1', 'repo2']
      };
      await handler(argv);

      expect(mockRepoGet).toBeCalledTimes(2);
      expect(mockArchive).toBeCalledTimes(4);
    });

    it('should archive content by folder id', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockArchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        folderId: 'folder1'
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(1);
      expect(mockItemsList).toBeCalledTimes(1);
      expect(mockArchive).toBeCalledTimes(2);
    });

    it('should archive content by folder ids', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockArchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        folderId: ['folder1', 'folder1']
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(2);
      expect(mockItemsList).toBeCalledTimes(2);
      expect(mockArchive).toBeCalledTimes(4);
    });

    it('should archive content by name', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockArchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        folderId: 'folder1',
        name: 'item1'
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(1);
      expect(mockItemsList).toBeCalledTimes(1);
      expect(mockArchive).toBeCalledTimes(1);
    });

    it("shouldn't archive content by name", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockArchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        folderId: 'folder1',
        name: 'item3'
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(1);
      expect(mockItemsList).toBeCalledTimes(1);
      expect(mockArchive).not.toBeCalled();
    });

    it("shouldn't archive content, answer no", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['n']);

      const { mockArchive, mockFolderGet, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        folderId: 'folder1',
        name: 'item1'
      };
      await handler(argv);

      expect(mockFolderGet).toBeCalledTimes(1);
      expect(mockItemsList).toBeCalledTimes(1);
      expect(mockArchive).not.toBeCalled();
    });

    it('should archive content by name regexp', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockArchive, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        name: '/item/'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockArchive).toBeCalledTimes(2);
    });

    it('should archive content by content type name', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockArchive, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        contentType: 'http://test.com'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockArchive).toBeCalledTimes(1);
    });

    it('should archive content by content type regexp', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockArchive, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        contentType: '/test/'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockArchive).toBeCalledTimes(2);
    });

    it('should archive content by content type regexp', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockArchive, mockItemsList } = mockValues();

      const argv = {
        ...yargArgs,
        ...config,
        contentType: '/test123/'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockArchive).toBeCalledTimes(0);
    });

    it('should archive content with ignoreError', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockArchive, mockItemsList } = mockValues(true);

      const argv = {
        ...yargArgs,
        ...config,
        ignoreError: true
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockArchive).toBeCalledTimes(2);
    });

    it('should archive content with ignoreError', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readline as any).setResponses(['y']);

      const { mockGet, mockGetList, mockArchive, mockItemsList } = mockValues(true);

      const argv = {
        ...yargArgs,
        ...config,
        ignoreError: false
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetList).toHaveBeenCalled();
      expect(mockItemsList).toHaveBeenCalled();
      expect(mockArchive).toBeCalledTimes(1);
    });
  });
});
