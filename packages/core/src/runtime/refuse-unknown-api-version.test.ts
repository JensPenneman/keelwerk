import { describe, expect, test } from 'vitest';
import type { ControlStore } from '../control/control-store.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import type { Invoker } from '../invoker/invoker.ts';
import { refuseUnknownApiVersion } from './refuse-unknown-api-version.ts';
import type { ServedApp } from './served-app.ts';

const clock = { now: () => Temporal.Instant.from('2026-11-05T10:00:00Z') };
const api = defineApiVersions({
  '2020-01-01': { deprecated: { at: '2020-06-01', sunset: '2021-01-01' } },
  '2026-11-04': {},
});

/** A control store answering the tenant row first and the backend row second. */
function storeOf(): ControlStore {
  const rows = [
    { id: 't1', backendId: 'b1' },
    { id: 'b1', app: 'shop' },
  ];
  let next = 0;
  return {
    entity: () => ({}),
    read: async (fn: (unit: unknown) => Promise<unknown>) =>
      fn({ rows: { find: async () => ({ rows: [rows[next++ % 2]] }) } }),
  } as unknown as ControlStore;
}

function served(withApi: boolean): ReadonlyMap<string, ServedApp> {
  const app = { id: 'shop', source: withApi ? { api } : {} } as unknown as ServedApp;
  return new Map([['shop', app]]);
}

const reached: string[] = [];
const inner = {
  open: async () => ({ ok: true, value: { principal: { kind: 'operator' } } }),
  invoke: async () => {
    reached.push('invoked');
    return { ok: true, value: {} };
  },
} as unknown as Invoker;

function pin(apps: ReadonlyMap<string, ServedApp>, apiVersion: string) {
  return refuseUnknownApiVersion(inner, apps, storeOf(), clock).invoke({
    action: 'core.tenant.setApiVersion',
    input: { id: 't1', apiVersion },
    carrier: { transport: 'test' },
    requestId: 'r',
    signal: new AbortController().signal,
  });
}

describe('setApiVersion checks the pin against the tenant app', () => {
  test('a retired version is refused, a served one reaches the command', async () => {
    expect(await pin(served(true), '2020-01-01')).toMatchObject({
      ok: false,
      error: { code: 'core.api_version_retired' },
    });
    reached.length = 0;
    expect(await pin(served(true), '2026-11-04')).toMatchObject({ ok: true });
    expect(reached).toEqual(['invoked']);
  });

  test('a version the app does not declare is refused', async () => {
    expect(await pin(served(true), '2025-01-01')).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
  });

  test('a process that does not serve the app answers unavailable', async () => {
    expect(await pin(new Map(), '2026-11-04')).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });
});
