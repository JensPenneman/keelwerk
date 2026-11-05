import type { Principal, PrincipalResolver } from '@keelwerk/core';
import type { TestApp, TestPrincipal } from '@keelwerk/testing';

const header = 'x-test-principal';

function isTestPrincipal(value: unknown): value is TestPrincipal {
  return typeof value === 'object' && value !== null && 'subject' in value && 'roles' in value;
}

/** Reads the principal a local client's carrier holds; the claim `operator: true` makes it an operator. */
const resolver: PrincipalResolver = {
  id: 'accounts.test-principal',
  describe: () => ({ scheme: 'apiKey', name: header }),
  *resolve(carrier, ctx) {
    const text = carrier.headers?.[header];
    if (text === undefined) return null;
    const held: unknown = JSON.parse(text);
    if (!isTestPrincipal(held)) return null;
    const base = {
      scope: {
        backend: ctx.scope.level === 'deployment' ? null : ctx.scope.backendId,
        tenant: ctx.scope.level === 'tenant' ? ctx.scope.tenantId : null,
      },
      claims: held.claims,
      roles: held.roles,
      memberships: [],
      via: 'accounts.test-principal',
      ref: null,
    };
    const principal: Principal =
      held.claims.operator === true
        ? { kind: 'operator', id: held.subject ?? 'operator', ...base }
        : held.subject === null
          ? { kind: 'anonymous', ...base }
          : {
              kind: 'user',
              subject: held.subject as never,
              subjectRef: null,
              subjectAs: () => null,
              ...base,
            };
    return { principal };
  },
};

/** The app with the test principal resolver added to the core's resolvers. */
export function withTestResolver<const App extends TestApp>(app: App): App {
  return {
    ...app,
    registry: {
      ...app.registry,
      fills: new Map([
        ...app.registry.fills,
        [
          'core.principalResolvers',
          [
            ...(app.registry.fills.get('core.principalResolvers') ?? []),
            { point: 'core.principalResolvers', module: 'core', bound: false, fill: resolver },
          ],
        ],
      ]),
    },
  };
}
