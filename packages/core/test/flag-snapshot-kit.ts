import { defineFlag } from '../src/dsl/define-flag.ts';
import type { FlagProvider } from '../src/flags/flag-provider.ts';
import { placeholderPrincipal } from '../src/invoker/edge/placeholder-principal.ts';
import type { Logger } from '../src/observability/logger.ts';
import type { Principal } from '../src/principals/principal.ts';
import type { ActionEntry } from '../src/registry/action-entry.ts';
import { buildRegistry } from '../src/registry/build-registry.ts';
import type { Scope } from '../src/storage/scope.ts';
import { appOf, makeModule } from './registry-kit.ts';

function capture(): { readonly log: Logger; readonly warnings: unknown[] } {
  const warnings: unknown[] = [];
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (_message, fields) => {
      warnings.push(fields);
    },
    child: () => log,
  };
  return { log, warnings };
}

export const snapshotRegistry = buildRegistry(
  appOf([
    makeModule({
      id: 'shop',
      gate: 'checkout',
      flags: {
        checkout: defineFlag({
          kind: 'boolean',
          default: false,
          level: 'tenant',
          purpose: 'release',
          expires: '2027-06-30',
        }),
        banner: defineFlag({
          kind: 'string',
          default: 'hi',
          level: 'backend',
          purpose: 'operational',
        }),
        beta: defineFlag({
          kind: 'boolean',
          default: false,
          level: 'principal',
          purpose: 'permission',
        }),
      },
    }),
    makeModule({
      id: 'other',
      flags: {
        unrelated: defineFlag({
          kind: 'boolean',
          default: false,
          level: 'tenant',
          purpose: 'operational',
        }),
      },
    }),
  ]),
);
export const snapshotAction = { ref: 'shop.pay', module: 'shop' } as ActionEntry;
export const snapshotScope: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };

export function snapshotInput(
  providers: readonly FlagProvider[],
  principal: Principal = placeholderPrincipal(snapshotScope),
) {
  const { log, warnings } = capture();
  return {
    warnings,
    input: {
      registry: snapshotRegistry,
      action: snapshotAction,
      scope: snapshotScope,
      principal,
      clientId: null,
      providers,
      log,
    },
  };
}
