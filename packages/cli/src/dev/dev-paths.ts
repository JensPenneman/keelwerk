import { join } from 'node:path';

/** Where `keelwerk dev` keeps its state below the project (S-47, section 13.6). */
export interface DevPaths {
  readonly root: string;
  /** The state directory, ignored by git. */
  readonly state: string;
  /** The PGlite directory: one database for the control store, one per placement below it. */
  readonly database: string;
  /** The operator socket of the app child. */
  readonly socket: string;
  /** The file that records where the running app's operator socket really is (a long path moves it). */
  readonly socketRecord: string;
  /** The ledger sink: a file outside the database. */
  readonly ledger: string;
  /** The generated deployment file the children load. */
  readonly deployment: string;
  /** The master key of the development database. */
  readonly masterKey: string;
}

/** The paths below `root`. */
export function devPathsOf(root: string): DevPaths {
  const state = join(root, '.keelwerk');
  return {
    root,
    state,
    database: join(state, 'dev-db'),
    socket: join(state, 'dev.sock'),
    socketRecord: join(state, 'dev-socket'),
    ledger: join(state, 'ledger.log'),
    deployment: join(state, 'dev-deployment.ts'),
    masterKey: join(state, 'dev-master-key'),
  };
}
