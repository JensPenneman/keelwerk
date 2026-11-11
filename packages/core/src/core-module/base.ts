import { defineModuleBase } from '../dsl/define-module-base.ts';
import { extensionPoint } from '../dsl/extension-point.ts';
import type { AdmissionRule } from '../edge/admission-rule.ts';
import type { PrincipalEnricher } from '../edge/principal-enricher.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import type { LiveCarrier } from '../live/live-carrier.ts';
import type { LiveHub } from '../live/live-hub.ts';
import type { TransportAdapter } from '../transport/transport-adapter.ts';
import type { CoreBase } from './core-base-type.ts';
import { backend } from './entities/backend.ts';
import { commandReceipt } from './entities/command-receipt.ts';
import { domain } from './entities/domain.ts';
import { effect } from './entities/effect.ts';
import { flag } from './entities/flag.ts';
import { namespace } from './entities/namespace.ts';
import { operatorToken } from './entities/operator-token.ts';
import { placement } from './entities/placement.ts';
import { process } from './entities/process.ts';
import { tenant } from './entities/tenant.ts';
import { effectAttempt } from './streams/effect-attempt.ts';

/** The base of the implicit core module (S-11, S-26). */
export const coreBase: CoreBase = defineModuleBase({
  id: 'core',
  version: '0.0.0',
  extensionPoints: {
    transports: extensionPoint.set<TransportAdapter>(),
    principalResolvers: extensionPoint.ordered<PrincipalResolver>(),
    principalEnrichers: extensionPoint.set<PrincipalEnricher>(),
    invocationMiddleware: extensionPoint.ordered<AdmissionRule>(),
    liveHub: extensionPoint.single<LiveHub>({ min: 0 }),
    liveCarriers: extensionPoint.set<LiveCarrier>(),
  },
  entities: {
    backend,
    tenant,
    domain,
    placement,
    namespace,
    operatorToken,
    commandReceipt,
    effect,
    process,
    flag,
  },
  streams: { effectAttempt },
});
