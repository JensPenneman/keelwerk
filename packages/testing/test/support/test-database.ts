/** The URLs and version of one database of the shared cluster. */
export interface TestDatabase {
  readonly adminUrl: string;
  readonly appUrl: string;
  readonly version: string;
}
