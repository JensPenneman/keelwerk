import type { ReactionPart } from '../dsl/define-reaction.ts';
import type { RulePart } from '../dsl/define-rule.ts';
import type { ClientFlagDocument } from '../flags/client-flag-document.ts';
import type { FlagTargeting } from '../flags/flag-targeting.ts';
import type { Id } from '../ids/id.ts';
import type { CapabilitiesDocument } from '../invoker/capabilities-document.ts';
import type { ActionPart, PartTypes, RowOutput } from '../model/action-part.ts';
import type { InstanceInput } from '../model/instance-input.ts';
import type { ModuleOf } from '../model/module-of.ts';
import type { Prettify } from '../model/prettify.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { CompositionReportDocument } from '../surface/composition-report-document.ts';
import type { Empty } from '../types/empty.ts';
import type { ApiUsageDocument } from './api-usage-document.ts';
import type { ApiVersionRetirement } from './api-version-retirement.ts';
import type { CoreBase } from './core-base-type.ts';
import type { MeDocument } from './me-document.ts';

type CoreQuery<Out = unknown> = ActionPart<
  'query',
  CoreBase,
  null,
  'sync',
  PartTypes<Prettify<Empty>, Out, never, never>
>;
type TenantCommand<In> = ActionPart<
  'command',
  CoreBase,
  'tenant',
  'sync',
  PartTypes<
    Prettify<Prettify<In & {}> & InstanceInput<'core.tenant'>>,
    RowOutput<'core.tenant'>,
    never,
    never
  >
>;
type BackendCreate<In, Out> = ActionPart<
  'command',
  CoreBase,
  'backend',
  'sync',
  PartTypes<Prettify<In & {}>, Out, never, never>
>;
type TenantCreate<In, Out> = ActionPart<
  'command',
  CoreBase,
  'tenant',
  'sync',
  PartTypes<Prettify<In & {}>, Out, never, never>
>;
type FlagCreate<In, Out> = ActionPart<
  'command',
  CoreBase,
  'flag',
  'sync',
  PartTypes<Prettify<In & {}>, Out, never, never>
>;
type FlagCommand<In> = ActionPart<
  'command',
  CoreBase,
  'flag',
  'sync',
  PartTypes<
    Prettify<Prettify<In & {}> & InstanceInput<'core.flag'>>,
    RowOutput<'core.flag'>,
    never,
    never
  >
>;
type FlagQuery<In, Out> = ActionPart<
  'query',
  CoreBase,
  'flag',
  'sync',
  PartTypes<Prettify<In & {}>, Out, never, never>
>;
type TokenCreate<In, Out> = ActionPart<
  'command',
  CoreBase,
  'operatorToken',
  'sync',
  PartTypes<Prettify<In & {}>, Out, never, never>
>;
type TokenCommand<In, Out> = ActionPart<
  'command',
  CoreBase,
  'operatorToken',
  'sync',
  PartTypes<Prettify<Prettify<In & {}> & InstanceInput<'core.operatorToken'>>, Out, never, never>
>;

type CoreInputQuery<In, Out> = ActionPart<
  'query',
  CoreBase,
  null,
  'sync',
  PartTypes<Prettify<In & {}>, Out, never, never>
>;
type CoreCommand<In, Out> = ActionPart<
  'command',
  CoreBase,
  null,
  'sync',
  PartTypes<Prettify<In & {}>, Out, never, never>
>;
type ApiUsageInput = {
  readonly since?: string | undefined;
  readonly until?: string | undefined;
  readonly backendId?: string | undefined;
  readonly apiVersion?: string | undefined;
  readonly item?: string | undefined;
};

/** The module literal of the core: the parts the core mounts (S-26, section 3.1). */
export interface CoreLiteral {
  readonly actions: {
    readonly introspect: CoreQuery<ApiSurface>;
    readonly composition: CoreQuery<CompositionReportDocument>;
    readonly me: CoreQuery<MeDocument>;
    readonly capabilities: CoreQuery<CapabilitiesDocument>;
    readonly apiUsage: CoreInputQuery<ApiUsageInput, ApiUsageDocument>;
    readonly retireApiVersion: CoreCommand<
      { readonly app: string; readonly version: string },
      ApiVersionRetirement
    >;
  };
  readonly policies: {
    readonly introspect: {
      readonly signedIn: RulePart<CoreBase, CoreQuery<ApiSurface>, readonly []>;
    };
    readonly composition: {
      readonly operators: RulePart<CoreBase, CoreQuery<CompositionReportDocument>, readonly []>;
    };
    readonly apiUsage: {
      readonly operators: RulePart<
        CoreBase,
        CoreInputQuery<ApiUsageInput, ApiUsageDocument>,
        readonly []
      >;
    };
    readonly retireApiVersion: {
      readonly operators: RulePart<
        CoreBase,
        CoreCommand<{ readonly app: string; readonly version: string }, ApiVersionRetirement>,
        readonly []
      >;
    };
    readonly operatorToken: {
      readonly operators: RulePart<CoreBase, 'operatorToken', readonly ['*']>;
    };
    readonly backend: { readonly operators: RulePart<CoreBase, 'backend', readonly ['*']> };
    readonly tenant: { readonly operators: RulePart<CoreBase, 'tenant', readonly ['*']> };
    readonly domain: { readonly operators: RulePart<CoreBase, 'domain', readonly ['*']> };
    readonly flag: { readonly operators: RulePart<CoreBase, 'flag', readonly ['*']> };
    readonly commandReceipt: {
      readonly submitter: RulePart<CoreBase, 'commandReceipt', readonly ['get', 'watch']>;
    };
  };
  readonly reactions: {
    readonly syncDomains: ReactionPart<CoreBase>;
    readonly syncDomainsOnChange: ReactionPart<CoreBase>;
  };
  readonly entityActions: {
    readonly backend: {
      readonly create: BackendCreate<
        {
          readonly name: string;
          readonly app: string;
          readonly placement: string;
          readonly apiVersion?: string | undefined;
          readonly config?: Record<string, unknown> | undefined;
        },
        { readonly id: Id<'core.backend'> }
      >;
    };
    readonly tenant: {
      readonly create: TenantCreate<
        {
          readonly backendId: Id<'core.backend'>;
          readonly name: string;
          readonly placement?: string | undefined;
          readonly apiVersion?: string | undefined;
          readonly domains?: readonly string[] | undefined;
        },
        { readonly id: Id<'core.tenant'> }
      >;
      readonly enter: TenantCommand<{ readonly reason: string }>;
      readonly setApiVersion: TenantCommand<{ readonly apiVersion: string }>;
    };
    readonly operatorToken: {
      readonly issue: TokenCreate<
        { readonly label: string; readonly ttl?: string | undefined },
        {
          readonly id: Id<'core.operatorToken'>;
          readonly token: string;
          readonly expiresAt: Temporal.Instant;
        }
      >;
      readonly revoke: TokenCommand<Empty, RowOutput<'core.operatorToken'>>;
    };
    readonly flag: {
      readonly set: FlagCreate<
        {
          readonly key: string;
          readonly backendId?: Id<'core.backend'> | undefined;
          readonly targeting: FlagTargeting;
          readonly reason: string;
        },
        { readonly id: Id<'core.flag'>; readonly ruleVersion: number }
      >;
      readonly restoreRules: FlagCommand<{ readonly reason: string; readonly ifVersion: number }>;
      readonly evaluate: FlagQuery<{ readonly key: string }, ClientFlagDocument>;
    };
  };
}

/** The implicit core module, always first in a selection (decision 104, section 4.7). */
export interface Core extends ModuleOf<CoreBase, CoreLiteral> {}
