import { builder, command, handler, LOG_FILENAME } from './archive';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import { ContentType, Hub } from 'dc-management-sdk-js';
import Yargs from 'yargs/yargs';
import MockPage from '../../common/dc-management-sdk-js/mock-page';
import { exists, readFile, unlink, mkdir, writeFile } from 'fs';
import { dirname } from 'path';
import { promisify } from 'util';
import readline from 'readline';

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

      const argv = {
        ...yargArgs,
        ...config
      };
      await handler(argv);

    });
  });
});
