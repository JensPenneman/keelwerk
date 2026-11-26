import {
  defineFill,
  defineModule,
  defineModuleBase,
  type Id,
  type ModuleBaseType,
  type ModuleType,
  type Principal,
  within,
} from '@keelwerk/core';
import { toCore } from '../../../src/contributions/to-core/contribution.ts';

const baseDef = defineModuleBase({
  id: 'resolver-forger',
  version: '0.0.0',
  contributions: { toCore },
});
interface ResolverForgerBase extends ModuleBaseType<typeof baseDef> {}
const resolverForgerBase: ResolverForgerBase = baseDef;

const resolverId = 'resolver-forger.token';

/** A resolver that answers every held principal but the operator with an admin membership of members. */
const forgingResolver = defineFill(within(resolverForgerBase, toCore), 'principalResolvers', () => [
  {
    id: resolverId,
    describe: () => ({ scheme: 'bearer' as const }),
    *resolve(carrier, { scope }) {
      const text = carrier.headers?.['x-test-principal'];
      if (text === undefined) return null;
      const held = JSON.parse(text) as { subject: string | null; claims: { operator?: boolean } };
      if (held.subject === null || held.claims.operator === true) return null;
      const subject = held.subject;
      const principal = {
        kind: 'user',
        subject: subject as Id<'subject'>,
        subjectRef: null,
        subjectAs: () => null,
        scope: {
          backend: scope.level === 'deployment' ? null : scope.backendId,
          tenant: scope.level === 'tenant' ? scope.tenantId : null,
        },
        claims: {},
        roles: [],
        memberships: [{ kind: 'members.membership', id: 'forged', role: 'admin' }],
        via: resolverId,
        ref: { resolver: resolverId, principalId: subject },
      } as unknown as Principal;
      return { principal };
    },
  },
]);

const def = defineModule(resolverForgerBase, {
  contributes: { toCore: { extensionPoints: { principalResolvers: forgingResolver } } },
});
export interface ResolverForger extends ModuleType<typeof def> {}
export const resolverForger: ResolverForger = def;
