import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataAdapter, TrackSnapshot } from '@keelwerk/core';
import { connectRewindCheck, createAnchorWriter, verifyAnchors } from '@keelwerk/core';
import { buildTrackSnapshot, commandReceiptDdl, orderTracks } from '@keelwerk/data';
import { type PgliteAdapter, pgliteAdapter } from '@keelwerk/data/pglite';
import { afterEach, describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { arraySink, bookShelf, targetsOf, tenantId, writer } from './support/anchor-kit.ts';
import { clock as fixedClock, namespace, silent, tenant } from './support/run-read-kit.ts';

const role = 'kw_app';
const directories: string[] = [];
const opened: PgliteAdapter[] = [];
afterEach(async () => {
  for (const adapter of opened.splice(0)) await adapter.close(1000).catch(() => undefined);
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function pgliteAt(dataDir: string, provision: boolean): Promise<PgliteAdapter & DataAdapter> {
  const adapter = pgliteAdapter(
    { deploymentId: '00000000-0000-4000-8000-0000000000d1' },
    { clock: fixedClock, dataDir },
  );
  opened.push(adapter);
  await adapter.connect();
  if (!provision) return adapter as PgliteAdapter & DataAdapter;
  await adapter.asOwner(async (database) => {
    await database.query(
      `create role "${role}" nosuperuser nobypassrls nocreatedb nocreaterole nologin`,
    );
  });
  const snapshots = buildTrackSnapshot([...conformanceApp.registry.entities.values()], {
    trackOfField: (entry, name) =>
      entry.ref === 'loans.loan' && name === 'bookId'
        ? 'loans[library]'
        : (entry.tracks.find((track) => track.contributedBy === entry.origin[name])?.track ??
          entry.tracks[0]?.track ??
          entry.module),
  });
  const modules = [
    { id: 'core', requires: [], optional: [] },
    { id: 'library', requires: [], optional: [] },
    { id: 'loans', requires: [], optional: ['library'] },
  ];
  await adapter.schema.provision(
    namespace,
    orderTracks(modules, [...snapshots.keys()]).map(
      (track) => snapshots.get(track) as TrackSnapshot,
    ),
  );
  await adapter.asOwner(async (database) => {
    for (const statement of commandReceiptDdl(namespace.root)) await database.query(statement);
    await database.query(
      `grant select, insert, update, delete on "${namespace.root}".core__command_receipt to "${role}"`,
    );
  });
  return adapter as PgliteAdapter & DataAdapter;
}

describe('a PGlite database restored from an older copy', () => {
  test('connect and verification name the rewound scope', { timeout: 120_000 }, async () => {
    const addBooks = bookShelf();
    const live = await mkdtemp(join(tmpdir(), 'kw-anchors-'));
    const backup = await mkdtemp(join(tmpdir(), 'kw-anchors-backup-'));
    directories.push(live, backup);
    const sink = arraySink();

    const first = await pgliteAt(live, true);
    await addBooks(first, 1);
    await first.close(1000);
    await cp(live, backup, { recursive: true });

    const second = await pgliteAt(live, false);
    await addBooks(second, 2);
    await createAnchorWriter({
      sinks: [sink],
      clock: fixedClock,
      writer,
      resolve: targetsOf(second),
      log: silent,
    }).onBatch([tenantId]);
    expect(await verifyAnchors([sink], targetsOf(second))).toMatchObject({ findings: [] });
    expect(await connectRewindCheck([sink], targetsOf(second))).toEqual([]);
    await second.close(1000);

    await rm(live, { recursive: true, force: true });
    await cp(backup, live, { recursive: true });
    const restored = await pgliteAt(live, false);
    const head = await restored.unit(namespace, tenant, (unit) => unit.events.head(), {
      readOnly: true,
    });
    expect(head).toBe(1n);
    expect(await connectRewindCheck([sink], targetsOf(restored))).toEqual([tenantId]);
    const verdict = await verifyAnchors([sink], targetsOf(restored));
    expect(verdict.findings.map((finding) => [finding.kind, finding.scopeId])).toEqual([
      ['missing', tenantId],
      ['behind', tenantId],
    ]);
  });
});
