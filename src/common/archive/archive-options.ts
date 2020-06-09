export default interface ArchiveOptions {
  id?: string;
  schemaId?: string | string[];
  repo?: string;
  folder?: string;
  name?: string;
  contentType?: string;
  logFile: string;
  revertLog?: string;
  force?: boolean;
  silent?: boolean;
  ignoreError?: boolean;
}
