import { describe, expect, test } from 'vitest';
import type { CredentialRedemption } from '../../edge/credential-redemption.ts';
import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { Registry } from '../../registry/registry.ts';
import type { EntityDescriptor } from '../../storage/entity-descriptor.ts';
import type { StorageRow } from '../../storage/storage-row.ts';
import { createInvokerEnv } from '../invoker-env.ts';
import type { InvokerOptions } from '../invoker-options.ts';
import type { ScopeTarget } from '../scope-target.ts';
import { spendCredential } from './spend-credential.ts';

const now = Temporal.Instant.from('2026-11-11T12:00:00Z');
const descriptor = { ref: 'doc.ticket', fields: { usedAt: {} } } as unknown as EntityDescriptor;
const bare = { ref: 'doc.bare', fields: {} } as unknown as EntityDescriptor;

function envOf(): ReturnType<typeof createInvokerEnv> {
  const registry = {
    entities: new Map([
      ['doc.ticket', { descriptor }],
      ['doc.bare', { descriptor: bare }],
    ]),
  } as unknown as Registry;
  const app = { registry, head: '2026-11-01' };
  return createInvokerEnv({
    apps: new Map([
      ['core', app],
      ['doc', app],
    ]),
    clock: { now: () => now },
  } as unknown as InvokerOptions);
}

/** A target whose unit holds the rows given, answering a conditional update like an adapter does. */
function targetOf(rows: Map<string, StorageRow>, race?: () => void): ScopeTarget {
  const unit = {
    rows: {
      findOne: async (_entity: unknown, query: { where: { value: string } }) => {
        const row = rows.get(query.where.value);
        race?.();
        return row;
      },
      update: async (
        _entity: unknown,
        updates: readonly { id: string; expectedVersion: number; values: StorageRow }[],
      ) => {
        for (const update of updates) {
          const held = rows.get(update.id);
          if (held === undefined || Number(held.version) !== update.expectedVersion) {
            throw new KeelwerkError({
              kind: 'conflict',
              code: 'core.version_mismatch',
              message: 'The row changed.',
            });
          }
          rows.set(update.id, update.values);
        }
      },
    },
  };
  return {
    scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
    namespace: { id: 'ns' },
    handle: {
      adapter: {
        unit: async (_ns: unknown, _scope: unknown, fn: (u: object) => unknown) => fn(unit),
      },
    },
  } as unknown as ScopeTarget;
}

const redemption = (over: Partial<CredentialRedemption> = {}): CredentialRedemption => ({
  entity: 'doc.ticket',
  id: 'tk1',
  version: 1,
  ref: { resolver: 'test.token', principalId: 'ada' },
  ...over,
});

async function refusal(work: Promise<void>): Promise<KeelwerkError> {
  try {
    await work;
  } catch (error) {
    return error as KeelwerkError;
  }
  throw new Error('expected a refusal');
}

describe('spendCredential', () => {
  test('spends a ticket once: usedAt and updatedAt are now and the version rises by one', async () => {
    const rows = new Map<string, StorageRow>([['tk1', { id: 'tk1', version: 1 }]]);
    await spendCredential(envOf(), targetOf(rows), 'doc', redemption());
    expect(rows.get('tk1')).toMatchObject({ version: 2, usedAt: now, updatedAt: now });
  });

  test('a second spend is core.ticket_invalid', async () => {
    const rows = new Map<string, StorageRow>([['tk1', { id: 'tk1', version: 1 }]]);
    const target = targetOf(rows);
    await spendCredential(envOf(), target, 'doc', redemption());
    const error = await refusal(spendCredential(envOf(), target, 'doc', redemption()));
    expect(error).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
  });

  test('a row at another version, spent or missing is core.ticket_invalid', async () => {
    const rows = new Map<string, StorageRow>([
      ['tk1', { id: 'tk1', version: 3 }],
      ['tk2', { id: 'tk2', version: 2, usedAt: now }],
    ]);
    const target = targetOf(rows);
    for (const id of ['tk1', 'tk2', 'gone']) {
      const error = await refusal(spendCredential(envOf(), target, 'doc', redemption({ id })));
      expect(error.code).toBe('core.ticket_invalid');
    }
  });

  test('a request that loses the race to the update is core.ticket_invalid', async () => {
    const rows = new Map<string, StorageRow>([['tk1', { id: 'tk1', version: 1 }]]);
    const target = targetOf(rows, () => {
      // Another request spends the row after this one read it.
      rows.set('tk1', { id: 'tk1', version: 2, usedAt: now });
    });
    const error = await refusal(spendCredential(envOf(), target, 'doc', redemption()));
    expect(error).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
  });

  test('an entity of another module, or one without usedAt, is internal', async () => {
    const rows = new Map<string, StorageRow>([['tk1', { id: 'tk1', version: 1 }]]);
    for (const entity of ['other.ticket', 'doc.bare']) {
      const error = await refusal(
        spendCredential(envOf(), targetOf(rows), 'doc', redemption({ entity })),
      );
      expect(error.kind).toBe('internal');
    }
  });
});
