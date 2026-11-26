import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiSurface } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { compareWithBase } from '../src/commands/surface/compare-with-base.ts';
import type { AppDerivation } from '../src/producers/app-derivation.ts';

const text = { kind: 'string', optional: false, access: 'read-write' } as const;
const empty = { kind: 'shape', optional: false, access: 'read-write', fields: {} } as const;
const action = (ref: string) => ({
  ref,
  module: 'auth',
  name: ref.split('.').at(-1),
  mount: 'module',
  kind: 'command',
  instance: false,
  input: { ...empty, fields: { id: text } },
  output: empty,
  errors: [],
  auth: 'policy',
  scope: 'tenant',
  execution: 'sync',
  idempotent: false,
  offline: false,
  resumable: false,
  hints: {},
  since: '2026-11-05',
  changedIn: [],
  inputHash: 'in',
  outputHash: 'out',
});
const surfaceOf = (version: string, refs: readonly string[]) =>
  ({
    format: 'keelwerk.surface/1',
    app: 'portal',
    apiVersion: version,
    hash: 'sha256-x',
    modules: [{ id: 'auth', version: '0.1.0' }],
    entities: [],
    actions: refs.map(action),
    errors: [],
    events: [],
  }) as unknown as ApiSurface;
const ledger = JSON.stringify({
  app: 'portal',
  format: 'keelwerk.ledger/1',
  versions: ['2026-11-05', '2026-11-12'].map((version) => ({
    changes: [],
    modules: { auth: '0.1.0' },
    surfaceHash: 'sha256-x',
    version,
  })),
});
const listing = (version: string) =>
  JSON.stringify(surfaceOf(version, ['auth.keep', 'auth.revokeSessions']));
const base = async (path: string) => {
  if (path.endsWith('ledger.json')) return ledger;
  const version = ['2026-11-05', '2026-11-12'].find((date) => path.endsWith(`${date}.json`));
  return version === undefined ? undefined : listing(version);
};
// The released entries of the ledger the working tree holds are the ones the base holds.
let workspace = '';
beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'surface-diff-'));
  const directory = join(workspace, 'generated', 'api-surface', 'portal');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'ledger.json'), ledger);
});
afterAll(() => rm(workspace, { recursive: true }));
const appOf = (dates: readonly string[], refs: readonly string[]) =>
  ({
    directory: workspace,
    app: { id: 'portal' },
    dates,
    surfaces: dates.map((date) => surfaceOf(date, refs)),
  }) as unknown as AppDerivation;
const compare = (app: AppDerivation) =>
  compareWithBase({ root: '/nowhere', apps: [app], readBase: base });

describe('an app that no longer lists an action, against the base that does', () => {
  test('the removal is breaking in the version that lists it, whatever the message says', async () => {
    const report = await compare(appOf(['2026-11-05', '2026-11-12'], ['auth.keep']));
    expect(report.failures).toEqual([
      'breaking portal 2026-11-05: auth.revokeSessions: The action was removed.',
      'breaking portal 2026-11-12: auth.revokeSessions: The action was removed.',
    ]);
  });

  test('it passes when the app declares a newer version and stops declaring that one', async () => {
    const report = await compare(appOf(['2026-11-26'], ['auth.keep']));
    expect(report.failures).toEqual([]);
    expect(report.notes).toContain('portal 2026-11-05: retired by raising the floor');
  });

  test('with two versions that list it, retiring one is not enough: every version that lists it must go', async () => {
    const kept = await compare(appOf(['2026-11-12', '2026-11-26'], ['auth.keep']));
    expect(kept.failures).toEqual([
      'breaking portal 2026-11-12: auth.revokeSessions: The action was removed.',
    ]);
    const both = await compare(appOf(['2026-11-26'], ['auth.keep']));
    expect(both.failures).toEqual([]);
    expect(both.notes).toEqual([
      'portal 2026-11-05: retired by raising the floor',
      'portal 2026-11-12: retired by raising the floor',
    ]);
  });
});
