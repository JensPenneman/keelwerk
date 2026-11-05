import { runApp } from './app-child.ts';
import { runProbe } from './probe-child.ts';

/** What a child process of the supervisor can be asked to run, by name (see `childCommand`). */
export const childEntries: {
  readonly probe: typeof runProbe;
  readonly app: typeof runApp;
} = { probe: runProbe, app: runApp };
