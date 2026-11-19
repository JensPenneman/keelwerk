import type { StreamDeclaration } from '../dsl/define-stream.ts';
import type { ExtensionPoint } from '../dsl/extension-point.ts';
import type { QuotaDimension } from '../dsl/quota.ts';
import type { AdmissionRule } from '../edge/admission-rule.ts';
import type { PrincipalEnricher } from '../edge/principal-enricher.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import type { FieldDef, OwnRef } from '../fields/field-def.ts';
import type { NoFlags, WithFlag } from '../fields/field-flags.ts';
import type { LiveCarrier } from '../live/live-carrier.ts';
import type { LiveHub } from '../live/live-hub.ts';
import type { TransportAdapter } from '../transport/transport-adapter.ts';
import type { CoreBaseEntities } from './core-base-entities-type.ts';

type Text = FieldDef<string, NoFlags, null, 'string'>;
type OptionalText = FieldDef<string, WithFlag<NoFlags, 'optional', true>, null, 'string'>;
type Count = FieldDef<number, NoFlags, null, 'integer'>;
type OwnId<E extends string> = FieldDef<never, NoFlags, OwnRef<E>, 'ref'>;
type AttemptError = FieldDef<EffectAttemptError, WithFlag<NoFlags, 'optional', true>, null, 'json'>;

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
  readonly quotas: {
    readonly rows: QuotaDimension<'count'>;
    readonly eventBytes: QuotaDimension<'bytes'>;
    readonly requestRate: QuotaDimension<'rate'>;
    readonly principalRequestRate: QuotaDimension<'rate'>;
    readonly commandRate: QuotaDimension<'rate'>;
    readonly queryRate: QuotaDimension<'rate'>;
    readonly subscribeRate: QuotaDimension<'rate'>;
    readonly concurrentInvocations: QuotaDimension<'count'>;
    readonly liveSubscriptions: QuotaDimension<'count'>;
    readonly liveConnections: QuotaDimension<'count'>;
  };
  readonly entities: CoreBaseEntities;
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
