import type { ControlStore } from '../control/control-store.ts';
import { findControlRows } from '../control/find-control-rows.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Scope } from '../storage/scope.ts';

/** How long a scope's configuration is served before the control store is read again. */
const maxAgeMs = 2000;

interface Held<T> {
  readonly at: number;
  readonly value: T;
}

/** The configuration and the domains of the scopes a transport serves, read through the control store (S-70). */
export interface BackendConfigs {
  /** `configOf(moduleId)` answers the module's `config` of the scope's backend: `undefined` until the backend has been opened or when the module has none. */
  configOf(moduleId: string): (scope: Scope) => unknown;
  /** The hostnames registered for the scope's tenant (empty until a session of the tenant has opened). */
  domainsOf(scope: Scope): readonly string[];
  /** The invoker with `open` refreshing the opened scope's configuration and domains, so the synchronous reads are current for the request. */
  around(invoker: Invoker): Invoker;
}

/**
 * Reads `core.backend.config` and the `core.domain` rows for each scope that opens a session and
 * keeps the last answer for a short while. The values come back as the control store holds them:
 * validation against the module's config shape and the unsealing of secret values belong to the
 * store's seam (WP-48).
 */
export function backendConfigs(store: ControlStore, clock: Clock): BackendConfigs {
  // TODO(WP-48): once the branch is rebased onto it, the config read here must become the validated, unsealed config of the store's seam.
  const configs = new Map<string, Held<unknown>>();
  const domains = new Map<string, Held<readonly string[]>>();
  // One read per key at a time: requests that open the same scope together share it.
  const reading = new Map<string, Promise<void>>();
  const fresh = <T>(held: Held<T> | undefined, now: number): boolean =>
    held !== undefined && now - held.at < maxAgeMs;
  const once = (key: string, read: () => Promise<void>): Promise<void> => {
    const running = reading.get(key);
    if (running !== undefined) return running;
    const started = read().finally(() => reading.delete(key));
    reading.set(key, started);
    return started;
  };
  const load = async (scope: Scope): Promise<void> => {
    if (scope.level === 'deployment') return;
    const { backendId } = scope;
    const now = clock.now().epochMilliseconds;
    if (!fresh(configs.get(backendId), now)) {
      // An expired entry is dropped before the read, so a read that fails never serves it again.
      configs.delete(backendId);
      await once(`config:${backendId}`, async () => {
        const [row] = await findControlRows(store, 'core.backend', { id: backendId });
        configs.set(backendId, { at: now, value: row?.config });
      });
    }
    if (scope.level !== 'tenant') return;
    const { tenantId } = scope;
    if (!fresh(domains.get(tenantId), now)) {
      domains.delete(tenantId);
      await once(`domains:${tenantId}`, async () => {
        const rows = await findControlRows(store, 'core.domain', { tenantId });
        domains.set(tenantId, {
          at: now,
          value: rows.flatMap((row) => (typeof row.hostname === 'string' ? [row.hostname] : [])),
        });
      });
    }
  };
  return {
    configOf: (moduleId) => (scope) => {
      if (scope.level === 'deployment') return undefined;
      const config = configs.get(scope.backendId)?.value;
      return typeof config === 'object' && config !== null
        ? Reflect.get(config, moduleId)
        : undefined;
    },
    domainsOf: (scope) =>
      scope.level === 'tenant' ? (domains.get(scope.tenantId)?.value ?? []) : [],
    around: (invoker) => ({
      ...invoker,
      open: async (carrier, options) => {
        const opened = await invoker.open(carrier, options);
        if (opened.ok) await load(opened.value.scope);
        return opened;
      },
    }),
  };
}
