import type {
  DataAdapter,
  DataAdapterFactory,
  KeyService,
  Logger,
  NamespaceRef,
  Outcome,
  Runtime,
  StorageRow,
  StoredEvent,
  SubjectKeyStore,
} from '@keelwerk/core';
import { createKeyService } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { vaultApp } from '../../../src/fixtures/index.ts';
import { pgliteFactory } from '../../../src/harness/pglite-factory.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { withTestResolver } from '../../../src/harness/with-test-resolver.ts';
import { ada, boot, deploymentOf, type Kind } from './runtime-kit.ts';

const credentialEntry = vaultApp.registry.entities.get('vault.credential');
if (credentialEntry === undefined) throw new Error('the vault fixture has no vault.credential');
export const credentialDescriptor = credentialEntry.descriptor;

/** A tenant of the vault's backend other than the first, with the same calls. */
export interface VaultTenant {
  readonly tenantId: string;
  call<T = unknown>(action: string, input: unknown): Promise<Outcome<T>>;
  raw<T>(fn: (view: { keys: SubjectKeyStore }) => Promise<T>): Promise<T>;
}

export interface Vault {
  readonly runtime: Runtime;
  readonly backendId: string;
  readonly tenantId: string;
  readonly infos: string[];
  /** Calls a vault action as `ada` in the tenant. */
  call<T = unknown>(action: string, input: unknown, commandId?: string): Promise<Outcome<T>>;
  /** The stored `core.backend` row of the vault's backend, read from the control store. */
  backendRow(): Promise<StorageRow | undefined>;
  /** Whether the control store holds a wrapped scope key for the scope id. */
  hasScopeKey(scopeId: string): Promise<boolean>;
  /** Runs `core.explain` as the operator over the vault's tenant. */
  explain(request: Record<string, unknown>): Promise<Outcome<unknown>>;
  /** A key service over the control store's scope keys and the test master key, to open what the runtime sealed. */
  keyService(): KeyService;
  /** Creates a second tenant in the same backend. */
  otherTenant(name: string): Promise<VaultTenant>;
  /** Reads the tenant's stored state and events, below every layer. */
  raw<T>(
    fn: (view: {
      rows(): Promise<readonly StorageRow[]>;
      events(id: string): Promise<readonly StoredEvent[]>;
      keys: SubjectKeyStore;
    }) => Promise<T>,
  ): Promise<T>;
}

/** The configuration the vault module requires of every backend: both of its fields have no default. */
export const vaultConfig = {
  vault: { endpoint: 'https://vault.example', signingKey: 'sign-me-secret' },
} as const;

/** Boots the vault fixture on the adapter, with a backend and a tenant, and a logger that keeps the info lines. */
export async function bootVault(
  kind: Kind,
  config: Readonly<Record<string, unknown>> = vaultConfig,
): Promise<Vault> {
  const captured: {
    adapter?: DataAdapter;
    namespace?: NamespaceRef;
    control?: { adapter: DataAdapter; namespace?: NamespaceRef };
  } = {};
  const infos: string[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: (message, fields) => {
      infos.push(`${message} ${JSON.stringify(fields ?? {})}`);
    },
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  const base: DataAdapterFactory = kind === 'memory' ? memoryAdapter() : pgliteFactory();
  const factory: DataAdapterFactory = {
    ...base,
    create: (placement, env) => {
      const adapter = base.create(placement, env);
      if (placement.id === 'control') {
        const control: { adapter: DataAdapter; namespace?: NamespaceRef } = { adapter };
        captured.control = control;
        return {
          ...adapter,
          schema: {
            ...adapter.schema,
            provision: async (namespace, snapshots, options) => {
              await adapter.schema.provision(namespace, snapshots, options);
              control.namespace = namespace;
            },
          },
        };
      }
      if (placement.id !== 'main') return adapter;
      const watched: DataAdapter = {
        ...adapter,
        schema: {
          ...adapter.schema,
          provision: async (namespace, snapshots, options) => {
            await adapter.schema.provision(namespace, snapshots, options);
            if (namespace.appId === 'vault') captured.namespace = namespace;
          },
        },
      };
      captured.adapter = watched;
      return watched;
    },
  };
  const runtime = await boot(deploymentOf(kind, { apps: [withTestResolver(vaultApp)], factory }), {
    logger,
  });
  const backend = await runtime.control.createBackend({
    name: 'vault',
    app: 'vault',
    placement: 'main',
    config,
  });
  const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
  const scope = { level: 'tenant', backendId: backend.id, tenantId: tenant.id } as const;
  return {
    runtime,
    backendId: backend.id,
    tenantId: tenant.id,
    infos,
    call: (action, input, commandId) =>
      runtime.invoker.invoke({
        action,
        input,
        carrier: testCarrier({ name: 'acme', id: tenant.id }, ada),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        ...(commandId === undefined ? {} : { commandId }),
      }),
    backendRow: async () => {
      const control = captured.control;
      const descriptor = vaultApp.registry.entities.get('core.backend')?.descriptor;
      if (control?.namespace === undefined || descriptor === undefined) {
        throw new Error('the control store is not up');
      }
      return control.adapter.unit(control.namespace, { level: 'deployment' }, async (unit) => {
        const page = await unit.rows.find(descriptor, {
          where: { op: 'eq', field: 'id', value: backend.id },
        });
        return page.rows[0];
      });
    },
    hasScopeKey: async (scopeId) => {
      const control = captured.control;
      if (control?.namespace === undefined) throw new Error('the control store is not up');
      return control.adapter.unit(control.namespace, { level: 'deployment' }, async (unit) => {
        return (await unit.scopeKeys?.current(scopeId)) !== undefined;
      });
    },
    otherTenant: async (name) => {
      const created = await runtime.control.createTenant({ backendId: backend.id, name });
      const other = { level: 'tenant', backendId: backend.id, tenantId: created.id } as const;
      return {
        tenantId: created.id,
        call: (action, input) =>
          runtime.invoker.invoke({
            action,
            input,
            carrier: testCarrier({ name, id: created.id }, ada),
            requestId: crypto.randomUUID(),
            signal: new AbortController().signal,
          }),
        raw: (fn) => {
          const { adapter, namespace } = captured;
          if (adapter === undefined || namespace === undefined) {
            throw new Error('the vault is not up');
          }
          return adapter.unit(namespace, other, (unit) => fn({ keys: unit.keys }));
        },
      };
    },
    explain: (request) =>
      runtime.invoker.invoke({
        action: 'core.explain',
        input: { backend: backend.id, tenant: tenant.id, ...request },
        carrier: {
          transport: 'cli',
          headers: { 'x-tenant': tenant.id },
          local: { inProcess: true },
        },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      }),
    keyService: () => {
      const control = captured.control;
      if (control?.namespace === undefined) throw new Error('the control store is not up');
      const { adapter, namespace } = control;
      const master = { version: 1, material: new Uint8Array(32).fill(7) };
      return createKeyService({
        master: { current: async () => master, byVersion: async () => master },
        deploymentId: 'test-deployment',
        withScopeKeys: (fn) =>
          adapter.unit(namespace, { level: 'deployment' }, (unit) => {
            if (unit.scopeKeys === undefined) throw new Error('no scope key store');
            return fn(unit.scopeKeys);
          }),
        clock: { now: () => Temporal.Now.instant() },
      });
    },
    raw: (fn) => {
      const { adapter, namespace } = captured;
      if (adapter === undefined || namespace === undefined) throw new Error('the vault is not up');
      return adapter.unit(namespace, scope, (unit) =>
        fn({
          rows: async () =>
            (
              await unit.rows.find(credentialDescriptor, {
                select: Object.keys(credentialDescriptor.fields),
              })
            ).rows,
          events: (id) => unit.events.readStream({ type: 'vault.credential', id }),
          keys: unit.keys,
        }),
      );
    },
  };
}
