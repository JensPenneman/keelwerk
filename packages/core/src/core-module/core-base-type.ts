import type { Entity } from '../dsl/define-entity.ts';
import type { StreamDeclaration } from '../dsl/define-stream.ts';
import type { ExtensionPoint } from '../dsl/extension-point.ts';
import type { AdmissionRule } from '../edge/admission-rule.ts';
import type { PrincipalEnricher } from '../edge/principal-enricher.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import type { FieldDef, OwnRef } from '../fields/field-def.ts';
import type { NoFlags, WithFlag } from '../fields/field-flags.ts';
import type { Shape } from '../fields/shape.ts';
import type { FlagTargeting } from '../flags/flag-targeting.ts';
import type { LiveCarrier } from '../live/live-carrier.ts';
import type { LiveHub } from '../live/live-hub.ts';
import type { TransportAdapter } from '../transport/transport-adapter.ts';
import type { Empty } from '../types/empty.ts';

type Text = FieldDef<string, NoFlags, null, 'string'>;
type OptionalText = FieldDef<string, WithFlag<NoFlags, 'optional', true>, null, 'string'>;
type UniqueText = FieldDef<
  string,
  WithFlag<WithFlag<WithFlag<NoFlags, 'unique', true>, 'merge', 'exclusive'>, 'personal', false>,
  null,
  'string'
>;
type Count = FieldDef<number, NoFlags, null, 'integer'>;
type OptionalCount = FieldDef<number, WithFlag<NoFlags, 'optional', true>, null, 'integer'>;
type OptionalDocument = FieldDef<
  Record<string, unknown>,
  WithFlag<NoFlags, 'optional', true>,
  null,
  'json'
>;
type HiddenOptionalDocument = FieldDef<
  Record<string, unknown>,
  WithFlag<WithFlag<NoFlags, 'optional', true>, 'hidden', true>,
  null,
  'json'
>;
type HiddenOptionalText = FieldDef<
  string,
  WithFlag<WithFlag<NoFlags, 'optional', true>, 'hidden', true>,
  null,
  'string'
>;
type DefaultedCount = FieldDef<number, WithFlag<NoFlags, 'defaulted', true>, null, 'integer'>;
type Moment = FieldDef<Temporal.Instant, NoFlags, null, 'instant'>;
type OptionalMoment = FieldDef<
  Temporal.Instant,
  WithFlag<NoFlags, 'optional', true>,
  null,
  'instant'
>;
type OwnId<E extends string> = FieldDef<never, NoFlags, OwnRef<E>, 'ref'>;
type OptionalOwnId<E extends string> = FieldDef<
  never,
  WithFlag<NoFlags, 'optional', true>,
  OwnRef<E>,
  'ref'
>;
type Status = FieldDef<'active' | 'suspended', WithFlag<NoFlags, 'defaulted', true>, null, 'enum'>;
type AttemptError = FieldDef<EffectAttemptError, WithFlag<NoFlags, 'optional', true>, null, 'json'>;
type NoSet = { readonly set: false };
type NoCreate = { readonly create: false };

/** The base of the implicit core module, written out because the core compiles with isolatedDeclarations (decision 104). */
export interface CoreBase {
  readonly id: 'core';
  readonly version: '0.0.0';
  readonly extensionPoints: {
    readonly transports: ExtensionPoint<TransportAdapter, 'set'>;
    readonly principalResolvers: ExtensionPoint<PrincipalResolver, 'ordered'>;
    readonly principalEnrichers: ExtensionPoint<PrincipalEnricher, 'set'>;
    readonly invocationMiddleware: ExtensionPoint<AdmissionRule, 'ordered'>;
    // Declared `single({ min: 0 })`: it reads `LiveHub | undefined`, since an app without the live module has no hub.
    readonly liveHub: ExtensionPoint<LiveHub, 'single', true>;
    readonly liveCarriers: ExtensionPoint<LiveCarrier, 'set'>;
  };
  readonly entities: {
    readonly backend: Entity<
      'bknd',
      {
        readonly name: UniqueText;
        readonly app: Text;
        readonly placement: Text;
        readonly apiVersion: OptionalText;
        readonly config: FieldDef<
          Record<string, unknown>,
          WithFlag<NoFlags, 'optional', true>,
          null,
          'json'
        >;
        readonly status: Status;
      },
      Empty,
      'chain',
      NoCreate,
      Empty
    >;
    readonly tenant: Entity<
      'tnt',
      {
        readonly backendId: OwnId<'backend'>;
        readonly name: Text;
        readonly placement: OptionalText;
        readonly apiVersion: OptionalText;
        readonly domains: FieldDef<readonly string[], NoFlags, null, 'list'>;
        readonly status: Status;
      },
      {
        readonly entered: Shape<{ readonly reason: Text }>;
        readonly hookFailed: Shape<{ readonly hook: Text }>;
        readonly hookCompleted: Shape<{ readonly hook: Text }>;
      },
      'chain',
      { readonly history: true; readonly create: false },
      Empty
    >;
    readonly domain: Entity<
      'dom',
      {
        readonly hostname: UniqueText;
        readonly backendId: OwnId<'backend'>;
        readonly tenantId: OwnId<'tenant'>;
      },
      Empty,
      'chain',
      NoSet,
      Empty
    >;
    readonly placement: Entity<
      'plc',
      {
        readonly name: UniqueText;
        readonly adapter: Text;
        readonly strategy: FieldDef<
          'database-per-tenant' | 'schema-per-tenant' | 'shared-tables',
          NoFlags,
          null,
          'enum'
        >;
      },
      Empty,
      'chain',
      NoSet,
      Empty
    >;
    readonly namespace: Entity<
      'nsp',
      {
        readonly placementId: OwnId<'placement'>;
        readonly appId: Text;
        readonly tenantId: OptionalOwnId<'tenant'>;
        readonly root: Text;
      },
      Empty,
      'chain',
      NoSet,
      Empty
    >;
    readonly operatorToken: Entity<
      'otk',
      {
        readonly label: Text;
        readonly publicId: UniqueText;
        readonly verifier: FieldDef<string, WithFlag<NoFlags, 'hidden', true>, null, 'verifier'>;
        readonly expiresAt: Moment;
        readonly revokedAt: OptionalMoment;
      },
      Empty,
      'chain',
      NoSet,
      Empty
    >;
    readonly commandReceipt: Entity<
      'rcpt',
      {
        readonly commandId: UniqueText;
        readonly action: Text;
        readonly fingerprint: Text;
        readonly principal: HiddenOptionalDocument;
        readonly principalResolver: OptionalText;
        readonly principalId: OptionalText;
        readonly status: FieldDef<
          'accepted' | 'completed' | 'failed' | 'pending',
          NoFlags,
          null,
          'enum'
        >;
        readonly outcome: OptionalDocument;
        readonly apiVersion: Text;
        readonly transport: Text;
        readonly remoteAddress: OptionalText;
        readonly userAgent: OptionalText;
        readonly clientId: OptionalText;
        readonly clientSeq: OptionalCount;
        readonly expiresAt: Moment;
        readonly acknowledgedAt: OptionalMoment;
      },
      Empty,
      'state',
      NoSet,
      Empty
    >;
    readonly effect: Entity<
      'eff',
      {
        readonly type: Text;
        readonly commandId: Text;
        readonly status: FieldDef<
          'abandoned' | 'failed' | 'requested' | 'succeeded',
          NoFlags,
          null,
          'enum'
        >;
        readonly attempts: DefaultedCount;
        readonly performer: FieldDef<'executor' | 'external', NoFlags, null, 'enum'>;
        readonly input: OptionalDocument;
        readonly eventIds: FieldDef<readonly string[], NoFlags, null, 'list'>;
        readonly continuation: OptionalText;
        readonly continuationWith: OptionalDocument;
        readonly key: OptionalText;
        readonly runAt: OptionalMoment;
        readonly deadline: OptionalMoment;
        readonly output: OptionalDocument;
        readonly error: OptionalDocument;
        readonly outputDigest: OptionalText;
        readonly settledAt: OptionalMoment;
        readonly principalResolver: HiddenOptionalText;
        readonly principalId: HiddenOptionalText;
      },
      Empty,
      'chain',
      NoSet,
      Empty
    >;
    readonly process: Entity<
      'proc',
      {
        readonly name: OptionalText;
        readonly node: Text;
        readonly roles: FieldDef<readonly ('serve' | 'work')[], NoFlags, null, 'list'>;
        readonly buildId: Text;
        readonly revision: Count;
        readonly state: FieldDef<
          'draining' | 'ready' | 'starting' | 'stopped',
          NoFlags,
          null,
          'enum'
        >;
        readonly heartbeatAt: Moment;
      },
      Empty,
      'state',
      NoSet,
      Empty
    >;
    readonly flag: Entity<
      'flg',
      {
        readonly slot: UniqueText;
        readonly key: Text;
        readonly backendId: OptionalOwnId<'backend'>;
        readonly targeting: FieldDef<FlagTargeting, NoFlags, null, 'json'>;
        readonly previous: FieldDef<
          FlagTargeting,
          WithFlag<NoFlags, 'optional', true>,
          null,
          'json'
        >;
        readonly reason: Text;
      },
      Empty,
      'chain',
      { readonly set: false; readonly history: true },
      Empty
    >;
  };
  readonly streams: {
    readonly effectAttempt: StreamDeclaration<
      OwnId<'effect'>,
      {
        readonly process: Text;
        readonly build: Text;
        readonly attempt: Count;
        readonly startedAt: Text;
        readonly endedAt: OptionalText;
        readonly error: AttemptError;
      }
    >;
  };
}
