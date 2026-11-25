import type {
  AdapterEnvironment,
  DataAdapter,
  DataAdapterFactory,
  DeploymentDefinition,
  PlacementConfig,
} from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';

/** The migration track that holds the deployment id in the control root (the core keeps its name private). */
const identityTrack = 'keelwerk.deployment';

/** What a fake control store was asked, in order. */
export interface FakeControlStore {
  readonly factory: DataAdapterFactory;
  /** The deployment id each created adapter was given. */
  readonly created: (string | undefined)[];
  readonly closed: number[];
  /** Settles when the first call that never answers has started. */
  readonly asked: Promise<void>;
  /** The adapters whose close has started and has not ended. */
  readonly closing: number[];
  /** The options of each unit that was opened. */
  readonly units: { readonly level: unknown; readonly options: unknown }[];
}

export interface FakeControlOptions {
  readonly id?: string;
  readonly dialect?: string;
  /** The deployment id recorded in the control root; none when absent. */
  readonly recorded?: string;
  /** Answers every connect; an error is thrown from it. */
  readonly connect?: (created: number) => Promise<void>;
  /** The message the read of the recorded id fails with. */
  readonly readFails?: string;
  /** A control root without tables: the introspection finds none and the history read fails. */
  readonly empty?: boolean;
  /** The calls that never answer: the read of the recorded id, a unit, a close. */
  readonly silent?: readonly ('connect' | 'history' | 'unit' | 'close')[];
}

/** A control store that records how it is used, with no database behind it. */
export function fakeControlStore(options: FakeControlOptions = {}): FakeControlStore {
  const asked = Promise.withResolvers<void>();
  const silence = (): Promise<never> => {
    asked.resolve();
    return new Promise<never>(() => undefined);
  };
  const store: FakeControlStore = {
    factory: {
      id: options.id ?? 'fake',
      dialect: options.dialect ?? 'postgres',
      options: {
        '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) },
      },
      create: (placement: PlacementConfig, env: AdapterEnvironment) => {
        const capabilities = memoryAdapter().create(placement, env);
        const index = store.created.push(env.deploymentId) - 1;
        const adapter = {
          connect: async () => {
            if (options.silent?.includes('connect')) await silence();
            await options.connect?.(index);
            return capabilities.connect();
          },
          close: async () => {
            store.closed.push(index);
            store.closing.push(index);
            if (options.silent?.includes('close')) await silence();
            store.closing.splice(store.closing.indexOf(index), 1);
          },
          schema: {
            introspect: async () => ({ tables: options.empty === true ? [] : [{}] }),
            history: async () => {
              if (options.empty === true) throw new Error('relation does not exist');
              if (options.silent?.includes('history')) await silence();
              if (options.readFails !== undefined) throw new Error(options.readFails);
              return options.recorded === undefined
                ? []
                : [{ track: identityTrack, id: options.recorded }];
            },
          },
          unit: async (
            _namespace: unknown,
            level: unknown,
            fn: (unit: unknown) => Promise<unknown>,
            unitOptions: unknown,
          ) => {
            store.units.push({ level, options: unitOptions });
            if (options.silent?.includes('unit')) await silence();
            return fn({
              rows: {
                count: async () => 0,
                find: async () => ({ rows: [], pageInfo: { hasNextPage: false, endCursor: null } }),
              },
              events: { head: async () => null, readAll: async () => ({ events: [], next: null }) },
              marks: { bumped: async () => [] },
            });
          },
        };
        return adapter as unknown as DataAdapter;
      },
    } as unknown as DataAdapterFactory,
    asked: asked.promise,
    created: [],
    closed: [],
    closing: [],
    units: [],
  };
  return store;
}

/** A deployment file's definition with this control store and no placement. */
export function definitionOver(
  store: FakeControlStore,
  control: DeploymentDefinition['control'] = {
    adapter: store.factory.id,
    url: 'postgres://u:p@h/db',
  },
): DeploymentDefinition {
  return { apps: [], infrastructure: [store.factory], control, placements: {} };
}
