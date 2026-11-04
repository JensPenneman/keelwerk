import type {
  ActionEntry,
  AdapterEnvironment,
  Clock,
  ComputePool,
  DataAdapter,
  EntityDescriptor,
  KeyService,
  Logger,
  NamespaceRef,
  Principal,
  Registry,
  Scope,
  Span,
  StorageRow,
  Unit,
} from '@keelwerk/core';
import { runRead } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { libraryApp } from '../../../src/fixtures/index.ts';

const bookEntry = libraryApp.registry.entities.get('library.book');
if (bookEntry === undefined) throw new Error('the library fixture has no book');

export type Asked<T = unknown> = Generator<never, T, unknown>;

export interface Page {
  readonly items: readonly StorageRow[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

export interface BookLoads {
  byId(id: string): Asked<StorageRow | undefined>;
  one(query: object): Asked<StorageRow | undefined>;
  many(query: object): Asked<readonly StorageRow[]>;
  count(where?: object): Asked<number>;
  exists(where: object): Asked<boolean>;
  query(query: object): Asked<Page>;
  forCaller(): BookLoads;
}

/** The members of the read context these tests reach. */
export interface ProbeContext {
  readonly load: { readonly library: { readonly book: BookLoads } };
  readonly flags: { readonly library: { readonly newShelves: Asked<boolean> } };
  /** The invoked action's own entity, narrowed and masked by that action's plan. */
  readonly target?: BookLoads;
  readonly secrets: Readonly<Record<string, unknown>>;
  readonly compute: {
    argon2idHash(password: string, salt: Uint8Array): Asked<string>;
    argon2idVerify(verifier: string, password: string): Asked<boolean>;
  };
  flagDetails(key: string): Asked;
  ask(ref: string, input: unknown): Asked;
  all(requests: readonly unknown[]): Asked<readonly unknown[]>;
  readonly [member: string]: unknown;
}

export const registry = libraryApp.registry;
export const book = bookEntry.descriptor;

export const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};
export const namespace: NamespaceRef = {
  id: 'ns-1',
  placementId: 'main',
  appId: 'library',
  tenantId: null,
  root: 'library',
};
export const tenant: Scope = {
  level: 'tenant',
  backendId: '00000000-0000-4000-8000-0000000000b1',
  tenantId: '00000000-0000-4000-8000-0000000000a1',
};
export const backend: Scope = {
  level: 'backend',
  backendId: tenant.level === 'tenant' ? tenant.backendId : '',
};
export const stamp = Temporal.Instant.from('2026-01-01T00:00:00Z');
export const clock: Clock = { now: () => stamp };
export const uuid = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export function userOf(subject: string): Principal {
  return {
    kind: 'user',
    subject,
    subjectRef: null,
    subjectAs: () => null,
    scope: { backend: tenant.level === 'tenant' ? tenant.backendId : null, tenant: null },
    claims: {},
    roles: [],
    memberships: [],
    via: 'test',
    ref: null,
  } as unknown as Principal;
}
export const anonymous = {
  kind: 'anonymous',
  scope: { backend: null, tenant: null },
  claims: {},
  roles: [],
  memberships: [],
  via: 'test',
  ref: null,
} as unknown as Principal;

export function bookRow(n: number, over: Record<string, unknown> = {}): StorageRow {
  return {
    id: uuid(n),
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    title: `Book ${n}`,
    isbn: `isbn-${n}`,
    addedBy: 'ada',
    ...over,
  };
}

export function open(
  extra: readonly EntityDescriptor[] = [book],
  adapterClock: Clock = clock,
): DataAdapter {
  const known = new Map(extra.map((entity) => [entity.ref, entity] as const));
  const environment: AdapterEnvironment = {
    deploymentId: '00000000-0000-4000-8000-0000000000d1',
    log: silent,
    tracer: {} as AdapterEnvironment['tracer'],
    secrets: { resolve: async () => '' },
    signal: new AbortController().signal,
  };
  return memoryAdapter({ clock: adapterClock, entities: (ref) => known.get(ref) }).create(
    { id: 'main', strategy: 'shared-tables' },
    environment,
  );
}

/** The registry with one more query, whose handler the test writes. */
export function withQuery(
  name: string,
  handler: ActionEntry['handler'],
  base: Registry = registry,
): { readonly registry: Registry; readonly ref: string } {
  const source = base.actions.get('library.findByIsbn');
  if (source === undefined) throw new Error('the library fixture has no findByIsbn');
  const ref = `library.${name}`;
  const action: ActionEntry = { ...source, ref, name, handler };
  return { registry: { ...base, actions: new Map([...base.actions, [ref, action]]) }, ref };
}

export function runnable(over: {
  readonly registry?: Registry;
  readonly action: string;
  readonly input?: unknown;
  readonly principal?: Principal;
  readonly scope?: Scope;
}) {
  const adapter = open();
  const scope = over.scope ?? tenant;
  return {
    adapter,
    seed: (rows: readonly StorageRow[]) =>
      adapter.unit(namespace, scope, (unit) => unit.rows.insert(book, rows)),
    run: (extra: Partial<Parameters<typeof runRead>[0]> = {}) =>
      runRead({
        registry: over.registry ?? registry,
        adapter,
        namespace,
        scope,
        action: over.action,
        input: over.input ?? {},
        principal: over.principal ?? userOf('ada'),
        request: { transport: 'test', requestId: 'r1' },
        clock,
        keys: {} as KeyService,
        compute: {} as ComputePool,
        log: silent,
        trace: {} as Span,
        concurrentUnits: true,
        ...extra,
      }),
  };
}

/** Wraps the adapter so each positioned read reports a rising position, to see the order loads were answered in. */
export function counting(adapter: DataAdapter): DataAdapter {
  let position = 0n;
  const wrap = (unit: Unit): Unit => ({
    ...unit,
    rows: {
      ...unit.rows,
      find: async (entity, query) => {
        const page = await unit.rows.find(entity, query);
        if (query.positioned !== true) return page;
        position += 1n;
        return { ...page, position };
      },
    },
  });
  return {
    ...adapter,
    unit: (ns, scope, fn, options) => adapter.unit(ns, scope, (unit) => fn(wrap(unit)), options),
  };
}
