import type { PrincipalResolver } from '../../src/edge/principal-resolver.ts';
import type { Carrier } from '../../src/invoker/carrier.ts';
import { createInvoker } from '../../src/invoker/create-invoker.ts';
import type { InvokerOptions } from '../../src/invoker/invoker-options.ts';
import type { Principal } from '../../src/principals/principal.ts';
import type { PrincipalRef } from '../../src/principals/principal-ref.ts';
import type { Registry } from '../../src/registry/registry.ts';
import type { EntityDescriptor } from '../../src/storage/entity-descriptor.ts';
import type { StorageRow } from '../../src/storage/storage-row.ts';
import { fixedKeys } from './fixed-keys.ts';
import { adapterOf, fill, namespace, registryOf } from './invoker-kit.ts';
import { staticScopeDirectory } from './static-scope-directory.ts';

const silentLog = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};
const ticketDescriptor = {
  ref: 'doc.ticket',
  fields: { usedAt: {} },
} as unknown as EntityDescriptor;
export function referredUserOf(subject: string): Principal {
  return {
    kind: 'user',
    subject,
    subjectRef: null,
    subjectAs: () => null,
    scope: { backend: 'b1', tenant: 't1' },
    claims: {},
    roles: [],
    memberships: [],
    via: 'test.ref',
    ref: { resolver: 'test.ref', principalId: subject },
  } as unknown as Principal;
}

export const standing: PrincipalRef = { resolver: 'test.ref', principalId: 'ada' };

/** The world of the tests: the rows a unit holds and the principals that are revoked. */
export function worldOf(
  ref: PrincipalRef = standing,
  entity = 'doc.ticket',
  extra: readonly PrincipalResolver[] = [],
  first: readonly PrincipalResolver[] = [],
  refused: (principalId: string) => Error | undefined = () => undefined,
) {
  const rows = new Map<string, StorageRow>([['tk1', { id: 'tk1', version: 1 }]]);
  const revoked = new Set<string>();
  const loaded: string[] = [];
  const redeeming: PrincipalResolver = {
    id: 'test.ticket',
    describe: () => ({ scheme: 'apiKey' }),
    // biome-ignore lint/correctness/useYield: the test resolver loads nothing
    *resolve(carrier) {
      if (carrier.ticket?.value !== 'good') return null;
      return {
        principal: referredUserOf('ignored'),
        redeem: { entity, id: 'tk1', version: 1, ref },
      };
    },
  };
  const referred: PrincipalResolver = {
    id: 'test.ref',
    describe: () => ({ scheme: 'apiKey' }),
    // biome-ignore lint/correctness/useYield: the test resolver loads nothing
    *resolve() {
      return null;
    },
    // biome-ignore lint/correctness/useYield: the test resolver loads nothing
    *fromRef(found) {
      loaded.push(found.principalId);
      const thrown = refused(found.principalId);
      if (thrown !== undefined) throw thrown;
      if (revoked.has(found.principalId)) return null;
      return {
        principal: referredUserOf(found.principalId),
        cache: { key: 'k', entity: 'doc.pass', id: 'p1' },
      };
    },
  };
  const base = registryOf([]);
  const registry: Registry = {
    ...base,
    entities: new Map([
      ...base.entities,
      ['doc.ticket', { ref: 'doc.ticket', module: 'doc', descriptor: ticketDescriptor } as never],
    ]),
    fills: new Map([
      [
        'core.principalResolvers',
        [...first, redeeming, referred, ...extra].map((resolver) =>
          fill('core.principalResolvers', resolver),
        ),
      ],
    ]),
  };
  const unit = {
    rows: {
      findOne: async (_entity: unknown, query: { where: { value: string } }) =>
        rows.get(query.where.value),
      update: async (_entity: unknown, updates: readonly { id: string; values: StorageRow }[]) => {
        for (const update of updates) rows.set(update.id, update.values);
      },
    },
  };
  const adapter = {
    ...adapterOf(),
    unit: async (_ns: unknown, _scope: unknown, fn: (u: object) => Promise<unknown>) => fn(unit),
  };
  const invoker = createInvoker({
    apps: new Map([
      ['doc', { registry, head: '2026-11-01' }],
      ['core', { registry, head: '2026-11-01' }],
    ]),
    directory: staticScopeDirectory({
      backends: [{ id: 'b1', app: 'doc', placementId: 'main', namespace, status: 'active' }],
      tenants: [{ id: 't1', backendId: 'b1', placementId: 'main', namespace, status: 'active' }],
    }),
    placement: () => ({ adapter }),
    tenantResolution: [{ kind: 'header', header: 'x-tenant' }],
    clock: { now: () => Temporal.Instant.from('2026-11-04T00:00:00Z') },
    keys: fixedKeys(),
    compute: {} as InvokerOptions['compute'],
    log: silentLog,
    environment: 'test',
  } as unknown as InvokerOptions);
  return { invoker, rows, revoked, loaded };
}

export const ticketCarrier: Carrier = {
  transport: 'test',
  headers: { 'x-tenant': 't1' },
  ticket: { value: 'good', endpoint: 'subscribe', action: null },
};
