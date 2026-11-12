import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Condition } from '../conditions/condition.ts';
import type { ControlStore } from '../control/control-store.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { repinRetiredPins } from './repin-retired-pins.ts';

type Row = { id: string; apiVersion: string | null; app?: string; backendId?: string };

const backends: Row[] = [];
const tenants: Row[] = [];
const reads: { entity: string; rows: number; where: Condition | undefined }[] = [];
const moved: string[] = [];
let onMove: (() => void) | undefined;

function matches(row: Row, where: Condition | undefined): boolean {
  if (where === undefined) return true;
  switch (where.op) {
    case 'and':
      return where.conditions.every((part) => matches(row, part));
    case 'or':
      return where.conditions.some((part) => matches(row, part));
    case 'eq':
      return (row as Record<string, unknown>)[where.field] === where.value;
    case 'lt':
      return String((row as Record<string, unknown>)[where.field]) < String(where.value);
    case 'in':
      return (where.value as readonly unknown[]).includes(
        (row as Record<string, unknown>)[where.field],
      );
    default:
      throw new Error(`the fake store does not know ${where.op}`);
  }
}

vi.mock('../control/run-control-command.ts', () => ({
  runControlCommand: async (
    _store: unknown,
    name: string,
    decide: (ctx: unknown) => { events: { row: Row; patch: { apiVersion: string } }[] },
  ) => {
    const update = (row: Row, patch: { apiVersion: string }) => ({ row, patch });
    const { events } = decide({ write: { core: { backend: { update }, tenant: { update } } } });
    for (const event of events) {
      event.row.apiVersion = event.patch.apiVersion;
      moved.push(`${name}:${event.row.id}`);
    }
    onMove?.();
  },
}));

const store = {
  entity: (ref: string) => ref,
  read: async (
    fn: (unit: {
      rows: {
        find: (
          entity: string,
          query: {
            where?: Condition;
            page: { first: number; after?: string };
          },
        ) => Promise<unknown>;
      };
    }) => unknown,
  ) =>
    fn({
      rows: {
        find: async (entity, query) => {
          const all = entity === 'core.backend' ? backends : tenants;
          const found = all
            .filter((row) => matches(row, query.where))
            .filter((row) => query.page.after === undefined || row.id > query.page.after)
            .sort((a, b) => a.id.localeCompare(b.id));
          const rows = found.slice(0, query.page.first);
          reads.push({ entity, rows: rows.length, where: query.where });
          return {
            rows: rows as readonly StorageRow[],
            pageInfo: {
              hasNextPage: found.length > rows.length,
              endCursor: rows.at(-1)?.id ?? null,
            },
          };
        },
      },
    }),
} as unknown as ControlStore;

const older = '2026-11-04';
const head = '2026-11-11';
const api = defineApiVersions({
  [older]: { deprecated: { at: '2026-11-10', sunset: '2026-12-01' } },
  [head]: {},
});
const today = '2026-12-02';

beforeEach(() => {
  backends.length = 0;
  tenants.length = 0;
  reads.length = 0;
  moved.length = 0;
  onMove = undefined;
  backends.push(
    { id: 'b1', app: 'shop', apiVersion: null },
    { id: 'b2', app: 'shop', apiVersion: head },
    { id: 'b9', app: 'other', apiVersion: older },
  );
  for (let at = 1; at <= 5; at += 1) {
    tenants.push({ id: `t${at}`, backendId: 'b1', apiVersion: older });
  }
  tenants.push(
    { id: 't6', backendId: 'b2', apiVersion: head },
    { id: 't7', backendId: 'b9', apiVersion: older },
    { id: 't8', backendId: 'b2', apiVersion: null },
  );
});

describe('repinRetiredPins', () => {
  test('reads the retired pins of the tenants of the app in pages and moves each one', async () => {
    const result = await repinRetiredPins(store, 'shop', api, today, { pageSize: 2 });
    expect(result).toEqual({ tenants: 5, backends: 0 });
    expect(tenants.map((row) => row.apiVersion)).toEqual([
      head,
      head,
      head,
      head,
      head,
      head,
      older,
      null,
    ]);
    const tenantReads = reads.filter((read) => read.entity === 'core.tenant');
    // No read holds more than a page, and the tenants of another app are never read.
    expect(Math.max(...tenantReads.map((read) => read.rows))).toBe(2);
    expect(tenantReads.length).toBeGreaterThan(2);
    expect(moved).not.toContain('tenant.repinApiVersion:t7');
    expect(reads.every((read) => read.where !== undefined)).toBe(true);
  });

  test('an abort stops the walk between rows and a rerun finishes the rest', async () => {
    const controller = new AbortController();
    onMove = () => {
      if (moved.length === 3) controller.abort(new Error('the caller has gone'));
    };
    await expect(
      repinRetiredPins(store, 'shop', api, today, { pageSize: 2, signal: controller.signal }),
    ).rejects.toThrow('the caller has gone');
    expect(moved).toEqual([
      'tenant.repinApiVersion:t1',
      'tenant.repinApiVersion:t2',
      'tenant.repinApiVersion:t3',
    ]);
    onMove = undefined;
    const rerun = await repinRetiredPins(store, 'shop', api, today, { pageSize: 2 });
    expect(rerun).toEqual({ tenants: 2, backends: 0 });
    expect(moved).toHaveLength(5);
  });

  test('a signal that is aborted already moves nothing', async () => {
    await expect(
      repinRetiredPins(store, 'shop', api, today, { signal: AbortSignal.abort(new Error('gone')) }),
    ).rejects.toThrow('gone');
    expect(moved).toEqual([]);
  });

  test('a backend with a retired default moves too, and a served pin stays', async () => {
    backends.push({ id: 'b3', app: 'shop', apiVersion: older });
    const result = await repinRetiredPins(store, 'shop', api, today);
    expect(result).toEqual({ tenants: 5, backends: 1 });
    expect(backends.find((row) => row.id === 'b3')?.apiVersion).toBe(head);
    expect(backends.find((row) => row.id === 'b2')?.apiVersion).toBe(head);
  });
});
