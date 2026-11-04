import type { DataAdapter, EntityEntry, TrackSnapshot } from '@keelwerk/core';
import { buildTrackSnapshot, orderTracks } from '@keelwerk/data';
import { commandReceiptDdl } from '@keelwerk/data/conformance';
import { type PgliteAdapter, pgliteAdapter } from '@keelwerk/data/pglite';
import { conformanceApp } from '../../../src/fixtures/index.ts';
import { clock, namespace } from './run-read-kit.ts';

/** The registry does not record conditional fields (gap in 14.6.1): `loans[library]` adds `bookId`. */
function trackOfField(entry: EntityEntry, field: string): string {
  const own = entry.tracks[0]?.track ?? entry.module;
  if (entry.ref === 'loans.loan' && field === 'bookId') return 'loans[library]';
  const contributor = entry.origin[field];
  if (contributor === undefined) return own;
  return entry.tracks.find((track) => track.contributedBy === contributor)?.track ?? own;
}

/** An in-memory PGlite adapter with the fixture's tables, framework tables and policies provisioned in the kit's namespace. */
export async function openPglite(): Promise<PgliteAdapter & DataAdapter> {
  const adapter = pgliteAdapter(
    { deploymentId: '00000000-0000-4000-8000-0000000000d1' },
    { clock },
  );
  await adapter.connect();
  await adapter.asOwner(async (database) => {
    await database.query(
      'create role "kw_app" nosuperuser nobypassrls nocreatedb nocreaterole nologin',
    );
  });
  const snapshots = buildTrackSnapshot([...conformanceApp.registry.entities.values()], {
    trackOfField,
  });
  const modules = [
    { id: 'core', requires: [], optional: [] },
    { id: 'library', requires: [], optional: [] },
    { id: 'loans', requires: [], optional: ['library'] },
  ];
  const tracks = orderTracks(modules, [...snapshots.keys()]);
  await adapter.schema.provision(
    namespace,
    tracks.map((track) => snapshots.get(track) as TrackSnapshot),
  );
  await adapter.asOwner(async (database) => {
    for (const statement of commandReceiptDdl(namespace.root)) await database.query(statement);
    await database.query(
      `grant select, insert, update, delete on "${namespace.root}".core__command_receipt to "kw_app"`,
    );
  });
  return adapter as PgliteAdapter & DataAdapter;
}
