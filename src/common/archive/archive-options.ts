export default interface ArchiveOptions {
  id?: string;
  schemaId?: string | string[];
  repoId?: string | string[];
  folderId?: string | string[];
  name?: string;
  contentType?: string;
  logFile?: string;
  revertLog?: string;
  force?: boolean;
  silent?: boolean;
  ignoreError?: boolean;
}
