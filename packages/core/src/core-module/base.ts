import { defineModuleBase } from '../dsl/define-module-base.ts';
import { extensionPoint } from '../dsl/extension-point.ts';
import type { AdmissionRule } from '../edge/admission-rule.ts';
import type { PrincipalEnricher } from '../edge/principal-enricher.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import type { TransportAdapter } from '../transport/transport-adapter.ts';
import type { CoreBase } from './core-base-type.ts';
import { backend } from './entities/backend.ts';
import { commandReceipt } from './entities/command-receipt.ts';
import { domain } from './entities/domain.ts';
import { effect } from './entities/effect.ts';
import { namespace } from './entities/namespace.ts';
import { operatorToken } from './entities/operator-token.ts';
import { placement } from './entities/placement.ts';
import { process } from './entities/process.ts';
import { tenant } from './entities/tenant.ts';

/** The base of the implicit core module (S-11, S-26). */
export const coreBase: CoreBase = defineModuleBase({
  id: 'core',
  version: '0.0.0',
  extensionPoints: {
    transports: extensionPoint.set<TransportAdapter>(),
    principalResolvers: extensionPoint.ordered<PrincipalResolver>(),
    principalEnrichers: extensionPoint.set<PrincipalEnricher>(),
    invocationMiddleware: extensionPoint.ordered<AdmissionRule>(),
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
  },
});
