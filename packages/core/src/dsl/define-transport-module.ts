import type { Core } from '../core-module/core-type.ts';
import { core } from '../core-module/module.ts';
import type { Shape } from '../fields/shape.ts';
import type { Dependency } from '../model/any-module.ts';
import type { ModuleLiteral } from '../model/module-literal.ts';
import type { ModuleOf } from '../model/module-of.ts';
import type { TransportAdapter } from '../transport/transport-adapter.ts';
import type { Empty } from '../types/empty.ts';
import type { ContributionDecl } from './define-contribution.ts';
import { defineContribution } from './define-contribution.ts';
import { defineModule } from './define-module.ts';
import { defineModuleBase } from './define-module-base.ts';

/** What `defineTransportModule` takes (section 5.6). */
export interface TransportModuleSpec<
  Id extends string,
  R extends readonly Dependency[],
  C extends Shape | undefined,
> {
  readonly id: Id;
  readonly version?: string;
  readonly requires?: R;
  readonly config?: C;
  readonly transport: TransportAdapter;
}

/** The base a transport module expands to: its dependencies and a contribution to the core. */
export interface TransportBase<Id extends string, R extends readonly Dependency[]> {
  readonly id: Id;
  readonly version: string;
  readonly requires?: R;
  readonly config?: Shape;
  readonly contributions: {
    readonly toCore: ContributionDecl<Core, readonly [], Empty>;
  };
}

/** The module literal a transport module expands to: the adapter fills the core's `transports` point. */
export interface TransportLiteral {
  readonly contributes: {
    readonly toCore: {
      readonly extensionPoints: { readonly transports: readonly [TransportAdapter] };
    };
  };
}

/**
 * The sugar for a transport module (section 5.6): a base requiring what the transport needs, a
 * contribution to the core, and a module literal that fills the core's `transports` point with
 * the adapter. The contribution targets the core, which every app has, so it is always active
 * and exempt from the dependency list.
 */
export function defineTransportModule<
  const Id extends string,
  const R extends readonly Dependency[] = readonly [],
  const C extends Shape | undefined = undefined,
>(spec: TransportModuleSpec<Id, R, C>): ModuleOf<TransportBase<Id, R>, TransportLiteral> {
  const base = defineModuleBase({
    id: spec.id,
    version: spec.version ?? '0.0.0',
    ...(spec.requires === undefined ? {} : { requires: spec.requires }),
    ...(spec.config === undefined ? {} : { config: spec.config }),
    contributions: { toCore: defineContribution(core, {}) },
  });
  const literal = {
    contributes: { toCore: { extensionPoints: { transports: [spec.transport] } } },
  } as const satisfies ModuleLiteral;
  return defineModule(base, literal);
}
