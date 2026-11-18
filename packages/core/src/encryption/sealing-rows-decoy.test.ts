import { hkdfSync } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { field } from '../fields/field.ts';
import { decoyKeyId } from '../keys/decoy-key-id.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { sealingUnit } from './sealing-unit.ts';

const person = defineEntity({
  prefix: 'prs',
  dataSubject: 'owner',
  fields: {
    owner: field.subject(),
    email: field.string({ format: 'email' }).personal({ normalize: 'email', queries: ['eq'] }),
    label: field.string().optional(),
  },
});
const registry = buildRegistry(appOf([makeModule({ id: 'dir', entities: { person } })]));
const descriptor = (() => {
  const found = registry.entities.get('dir.person')?.descriptor;
  if (found === undefined) throw new Error('no dir.person');
  return found;
})();

const root = new Uint8Array(32).fill(7);
const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;

/** A raw unit over a list of rows, whose key store records every call it gets. */
function recordingUnit() {
  const calls: string[] = [];
  const stored: StorageRow[] = [];
  const keys = new Map<string, DataKey>();
  let created = 0;
  const unit = {
    scope,
    namespace: { id: 'ns-1' },
    keys: {
      dataKey: async (subject: string) => {
        calls.push('dataKey');
        const existing = keys.get(subject);
        if (existing !== undefined) return existing;
        created += 1;
        const made = {
          id: `00000000-0000-4000-8000-0000000000${String(created).padStart(2, '0')}`,
          material: new Uint8Array(32).fill(created),
        };
        keys.set(subject, made);
        return made;
      },
      keyById: async (keyId: string) => {
        calls.push('keyById');
        return [...keys.values()].find((key) => key.id === keyId);
      },
    },
    rows: {
      insert: async (_entity: unknown, rows: readonly StorageRow[]) => {
        stored.push(...rows);
      },
      // The adapter's match on the equality tag column, as its index would answer it.
      find: async (_entity: unknown, query: { where?: { field: string; value: Uint8Array } }) => ({
        rows: stored.filter((candidate) => {
          const wanted = query.where;
          const held = wanted === undefined ? undefined : candidate[wanted.field];
          return (
            wanted !== undefined &&
            held instanceof Uint8Array &&
            Buffer.from(held).equals(Buffer.from(wanted.value))
          );
        }),
        next: null,
      }),
    },
  };
  return { raw: unit as unknown as Unit, calls };
}

function sealed(raw: Unit): Unit {
  return sealingUnit(raw, {
    keys: {
      derive: async (forScope, info, length) =>
        new Uint8Array(hkdfSync('sha256', root, JSON.stringify(forScope), info, length)),
    },
    describe: (_namespace, ref) => (ref === descriptor.ref ? descriptor : undefined),
    maxScan: 100,
  });
}

const row = (email: string): StorageRow => ({ id: 'row-1', owner: 'owner-1', email });

describe('a lookup by a personal value that finds no row (17.2.2, 17.2.5)', () => {
  test('makes the key-store calls of a lookup that finds one row', async () => {
    const { raw, calls } = recordingUnit();
    await sealed(raw).rows.insert(descriptor, [row('ada@example.org')]);
    // Each lookup is a unit of its own, with its own key cache, as a request's is.
    calls.length = 0;
    const hit = await sealed(raw).rows.find(descriptor, {
      where: { op: 'eq', field: 'email', value: 'ada@example.org' },
    });
    expect(hit.rows).toHaveLength(1);
    const forHit = [...calls];
    calls.length = 0;
    const miss = await sealed(raw).rows.find(descriptor, {
      where: { op: 'eq', field: 'email', value: 'nobody@example.org' },
    });
    // The store holds no row of that tag: the page is empty and still costs the key read of a hit.
    expect(miss.rows).toHaveLength(0);
    expect(forHit).toEqual(['keyById']);
    expect(calls).toEqual(forHit);
  });

  test('reads the decoy key and no other', async () => {
    const { raw } = recordingUnit();
    const read: string[] = [];
    const keys = raw.keys as unknown as { keyById: (id: string) => Promise<unknown> };
    const inner = keys.keyById.bind(keys);
    keys.keyById = (id) => {
      read.push(id);
      return inner(id);
    };
    const unit = sealed(raw);
    await unit.rows.find(descriptor, {
      where: { op: 'eq', field: 'email', value: 'nobody@example.org' },
    });
    expect(read).toEqual([decoyKeyId]);
  });

  test('a lookup on no personal field reads no decoy', async () => {
    const { raw, calls } = recordingUnit();
    const unit = sealed(raw);
    await unit.rows.find(descriptor, { where: { op: 'eq', field: 'label', value: 'x' } });
    expect(calls).toEqual([]);
  });
});
