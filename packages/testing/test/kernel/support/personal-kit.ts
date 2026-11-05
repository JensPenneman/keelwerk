import type {
  DataAdapter,
  DataAdapterFactory,
  EntityDescriptor,
  NamespaceRef,
  Outcome,
  Runtime,
  StorageRow,
  StoredEvent,
  SubjectKeyStore,
} from '@keelwerk/core';
import {
  type AppType,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  type EntityType,
  field,
  type ModuleBaseType,
  type ModuleType,
  secret,
  shape,
} from '@keelwerk/core';
import { fallbackReporter, memoryAdapter, schemaPlanner } from '@keelwerk/data';
import { pgliteFactory } from '../../../src/harness/pglite-factory.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testMasterKeyName } from '../../../src/harness/test-master-key-name.ts';
import { testSecrets } from '../../../src/harness/test-secrets.ts';
import { withTestResolver } from '../../../src/harness/with-test-resolver.ts';
import { ada, boot, type Kind } from './runtime-kit.ts';

const personDef = defineEntity({
  prefix: 'pers',
  dataSubject: 'id',
  fields: {
    name: field.string({ maxLength: 100 }),
    email: field
      .string({ format: 'email' })
      .unique()
      .personal({ normalize: 'email', queries: ['prefix'] }),
    nickname: field
      .string({ maxLength: 40 })
      .optional()
      .personal({ normalize: 'caseless', queries: ['eq'] }),
    notes: field.string().optional().personal(),
  },
});
interface Person extends EntityType<typeof personDef> {}
const person: Person = personDef;

const peopleBaseDef = defineModuleBase({ id: 'people', version: '0.1.0', entities: { person } });
interface PeopleBase extends ModuleBaseType<typeof peopleBaseDef> {}
const peopleBase: PeopleBase = peopleBaseDef;

const readers = defineRule(peopleBase, person, {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  reason: 'A signed-in user reads every person.',
});
const writers = defineRule(peopleBase, person, {
  effect: 'allow',
  actions: ['write'],
  principal: 'user',
  reason: 'A signed-in user writes every person.',
});

const enrol = defineCommand(peopleBase, {
  input: shape({
    name: field.string({ maxLength: 100 }),
    email: field.string({ format: 'email' }),
    notes: field.string().optional(),
  }),
  output: shape({ personId: field.ref.own('person') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(person);
    return {
      events: [
        ctx.write.people.person.create({
          id,
          name: input.name,
          email: input.email,
          ...(input.notes === undefined ? {} : { notes: input.notes }),
        }),
      ],
      result: { personId: id },
    };
  },
});
const enrolSignedIn = defineRule(peopleBase, enrol, { effect: 'allow', principal: 'user' });

const peopleDef = defineModule(peopleBase, {
  actions: { enrol },
  policies: { enrol: { signedIn: enrolSignedIn }, person: { readers, writers } },
});
interface People extends ModuleType<typeof peopleDef> {}
const people: People = peopleDef;

const peopleAppDef = defineApp({ id: 'people', modules: [people] as const });
interface PeopleApp extends AppType<typeof peopleAppDef> {}
const app: PeopleApp = peopleAppDef;

const entry = app.registry.entities.get('people.person');
if (entry === undefined) throw new Error('the people app has no people.person');

/** The people app: one entity with personal fields under three normalisers. */
export const peopleApp: PeopleApp = app;
/** The descriptor of `people.person`. */
export const personDescriptor: EntityDescriptor = entry.descriptor;

/** What the tests read of a person page. */
export interface PersonRow {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly email: string;
  readonly nickname?: string;
  readonly notes?: string;
}

/** A page of the generated query. */
export interface PersonPage {
  readonly items: readonly PersonRow[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  readonly total?: number;
  readonly queryState: string;
}

/** The people app booted on an adapter, with the raw stored state at hand. */
export interface People_ {
  readonly runtime: Runtime;
  call<T = unknown>(action: string, input: unknown): Promise<Outcome<T>>;
  /** Creates a person and returns the row. */
  create(values: Record<string, unknown>): Promise<PersonRow>;
  /** Runs the generated query with a filter and returns the names in id order of creation. */
  find(filter: unknown, extra?: Record<string, unknown>): Promise<Outcome<PersonPage>>;
  /** The tenant's state and events below the sealing layer, as the database holds them. */
  raw<T>(
    fn: (view: {
      rows(): Promise<readonly StorageRow[]>;
      events(id: string): Promise<readonly StoredEvent[]>;
      keys: SubjectKeyStore;
      namespace: NamespaceRef;
    }) => Promise<T>,
  ): Promise<T>;
}

/** Where the people app stores: an adapter factory, the placement url when it has one, and a scan bound for the tests. */
export interface PeopleTarget {
  readonly factory: DataAdapterFactory;
  readonly url?: string;
  /** Replaces the adapter's `maxScan` capability. */
  readonly maxScan?: number;
}

/** Boots the people app with a backend and a tenant on the in-memory or the PGlite adapter. */
export function bootPeople(kind: Kind, maxScan?: number): Promise<People_> {
  return bootPeopleOn({
    factory: kind === 'memory' ? memoryAdapter() : pgliteFactory(),
    ...(maxScan === undefined ? {} : { maxScan }),
  });
}

/** Boots the people app with a backend and a tenant on the given adapter. */
export async function bootPeopleOn(target: PeopleTarget): Promise<People_> {
  const captured: { adapter?: DataAdapter; namespace?: NamespaceRef } = {};
  const { maxScan } = target;
  const base = target.factory;
  const factory: DataAdapterFactory = {
    ...base,
    create: (placement, env) => {
      const adapter = base.create(placement, env);
      if (placement.id !== 'main') return adapter;
      captured.adapter = {
        ...adapter,
        connect: async () => {
          const capabilities = await adapter.connect();
          return maxScan === undefined
            ? capabilities
            : { ...capabilities, encryptedQueries: { ...capabilities.encryptedQueries, maxScan } };
        },
        schema: {
          ...adapter.schema,
          provision: async (namespace, snapshots, options) => {
            await adapter.schema.provision(namespace, snapshots, options);
            if (namespace.appId === 'people') captured.namespace = namespace;
          },
        },
      };
      return captured.adapter;
    },
  };
  const url = target.url === undefined ? {} : { url: target.url };
  const runtime = await boot({
    apps: [withTestResolver(peopleApp)],
    infrastructure: [factory, schemaPlanner(), fallbackReporter(), testSecrets],
    control: { adapter: factory.id, ...url },
    placements: { main: { adapter: factory.id, strategy: 'shared-tables', ...url } },
    tenantResolution: [{ kind: 'hostname' }, { kind: 'header', header: 'x-tenant' }],
    keys: { masterKey: secret(testMasterKeyName) },
  });
  const backend = await runtime.control.createBackend({
    name: 'people',
    app: 'people',
    placement: 'main',
  });
  const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
  const scope = { level: 'tenant', backendId: backend.id, tenantId: tenant.id } as const;
  const call = <T>(action: string, input: unknown): Promise<Outcome<T>> =>
    runtime.invoker.invoke({
      action,
      input,
      carrier: testCarrier({ name: 'acme', id: tenant.id }, ada),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  return {
    runtime,
    call,
    create: async (values) => {
      const outcome = await call<PersonRow>('people.person.create', values);
      if (!outcome.ok) throw outcome.error;
      return outcome.value;
    },
    find: (filter, extra = {}) => call<PersonPage>('people.person.query', { filter, ...extra }),
    raw: (fn) => {
      const { adapter, namespace } = captured;
      if (adapter === undefined || namespace === undefined) throw new Error('the app is not up');
      return adapter.unit(namespace, scope, (unit) =>
        fn({
          namespace,
          rows: async () =>
            (
              await unit.rows.find(personDescriptor, {
                select: [
                  ...Object.keys(personDescriptor.fields),
                  ...Object.keys(personDescriptor.derivedIndexes),
                ],
                includeArchived: true,
              })
            ).rows,
          events: (id) => unit.events.readStream({ type: 'people.person', id }),
          keys: unit.keys,
        }),
      );
    },
  };
}
