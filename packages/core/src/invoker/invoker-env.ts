import { trace } from '@opentelemetry/api';
import { normalizeRule } from '../authorization/normalize-rule.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { TenantResolver } from '../edge/tenant-resolver.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Tracer } from '../observability/tracer.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { InvokerApp } from './invoker-app.ts';
import type { InvokerOptions } from './invoker-options.ts';
import type { SessionRegistry } from './session-registry.ts';
import { createSessionRegistry } from './session-registry.ts';
import type { EntityOutput } from './stages/entity-output-of.ts';
import { entityOutputOf } from './stages/entity-output-of.ts';

/** Refuses the tenant resolvers the release cannot run (S-20): the named problem `scopeDirectoryUnavailable`. */
function checkResolvers(resolvers: readonly TenantResolver[]): void {
  for (const resolver of resolvers) {
    if (resolver.kind === 'scopeKey' || resolver.kind === 'path') {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `The tenant resolver "${resolver.kind}" needs the scope directory, which this release does not have.`,
        details: { code: 'scopeDirectoryUnavailable', resolver: resolver.kind },
      });
    }
  }
}

/** What every stage of one invoker shares: its options with the defaults filled in, and its caches. */
export interface InvokerEnv {
  readonly options: InvokerOptions;
  readonly sessions: SessionRegistry;
  readonly tracer: Tracer;
  readonly tenantResolution: readonly TenantResolver[];
  /** The app served under the id; `unavailable` when this process does not hold it. */
  appOf(id: string): InvokerApp;
  /** The registry's enabled rules, normalised once. */
  rulesOf(registry: Registry): readonly NormalizedRule[];
  /** The entity rows an action's output carries, found once per registry and action; throws when ambiguous. */
  entityOutputOf(registry: Registry, action: ActionEntry): EntityOutput | undefined;
}

/** Builds the shared environment of an invoker; refuses an unusable tenant resolution at once. */
export function createInvokerEnv(options: InvokerOptions): InvokerEnv {
  if (!options.apps.has('core')) {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message:
        'The invoker needs the "core" app: deployment-level actions and the operator run in it.',
    });
  }
  const tenantResolution = options.tenantResolution ?? [{ kind: 'hostname' }];
  checkResolvers(tenantResolution);
  const rules = new WeakMap<Registry, readonly NormalizedRule[]>();
  const outputs = new WeakMap<Registry, Map<string, EntityOutput | undefined>>();
  return {
    options,
    sessions: createSessionRegistry(),
    tracer: options.tracer ?? trace.getTracer('keelwerk'),
    tenantResolution,
    appOf: (id) => {
      const app = options.apps.get(id);
      if (app === undefined) {
        throw new KeelwerkError({
          kind: 'unavailable',
          code: 'core.unavailable',
          message: `App "${id}" is not served by this process.`,
        });
      }
      return app;
    },
    rulesOf: (registry) => {
      const known = rules.get(registry);
      if (known !== undefined) return known;
      const built = [...registry.rules.values()]
        .filter((rule) => rule.disabled !== true)
        .map(normalizeRule);
      rules.set(registry, built);
      return built;
    },
    entityOutputOf: (registry, action) => {
      const known = outputs.get(registry) ?? new Map<string, EntityOutput | undefined>();
      outputs.set(registry, known);
      if (known.has(action.ref)) return known.get(action.ref);
      const found = entityOutputOf(registry, action);
      known.set(action.ref, found);
      return found;
    },
  };
}
