export default interface ArchiveOptions {
  id?: string;
  schemaId?: string | string[];
  logFile?: string;
  repoId?: string | string[];
  folderId?: string | string[];
  name?: string | string[];
  contentType?: string | string[];
  revertLog?: string;
  force?: boolean;
  silent?: boolean;
  ignoreError?: boolean;
}
