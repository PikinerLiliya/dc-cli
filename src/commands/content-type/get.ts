import { Arguments, Argv } from 'yargs';
import DataPresenter, { RenderingArguments, RenderingOptions } from '../../view/data-presenter';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import { ContentType } from 'dc-management-sdk-js';
import { ConfigurationParameters } from '../configure';
import { singleItemTableOptions } from '../../common/table/table.consts';
import BuilderOptions from '../../interfaces/builder-options';

export const command = 'get [id]';

export const desc = 'Get Content Type';

export const builder = (yargs: Argv): void => {
  yargs
    .positional('id', {
      describe: 'Content Type ID',
      type: 'string',
      demandOption: true
    })
    .options(RenderingOptions);
};

export const handler = async (
  argv: Arguments<BuilderOptions & ConfigurationParameters & RenderingArguments>
): Promise<void> => {
  const client = dynamicContentClientFactory(argv);

  const contentType: ContentType = await client.contentTypes.get(argv.id);
  new DataPresenter(contentType.toJson()).render({
    json: argv.json,
    tableUserConfig: singleItemTableOptions
  });
};