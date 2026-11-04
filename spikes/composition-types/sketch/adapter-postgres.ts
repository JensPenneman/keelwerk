import type { StubEntry } from './infrastructure-entry.ts';

/** Stand-in for @keelwerk/adapter-postgres: the data adapter factory 'postgres'. */
export function postgresAdapter(): StubEntry<readonly []> {
  return { kind: 'adapter:postgres', provides: [] };
}
