import type { PrincipalResolver, ServicePrincipal } from '@keelwerk/core';
import type { TestApp } from '../../../src/harness/test-app.ts';

/** The header a carrier holds a service principal in: `{ id, principalId }` as JSON. */
const serviceHeader = 'x-test-service';

const resolver: PrincipalResolver = {
  id: 'test.service',
  describe: () => ({ scheme: 'apiKey', name: serviceHeader }),
  *resolve(carrier, ctx) {
    const text = carrier.headers?.[serviceHeader];
    if (text === undefined) return null;
    const held = JSON.parse(text) as { readonly id: string; readonly principalId: string };
    const principal: ServicePrincipal = {
      kind: 'service',
      id: held.id,
      idAs: () => null,
      scope: {
        backend: ctx.scope.level === 'deployment' ? null : ctx.scope.backendId,
        tenant: ctx.scope.level === 'tenant' ? ctx.scope.tenantId : null,
      },
      claims: {},
      roles: [],
      memberships: [],
      via: 'test.service',
      ref: { resolver: 'test.service', principalId: held.principalId },
    };
    return { principal };
  },
  // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
  *fromRef() {
    return null;
  },
};

/** The app with a resolver that turns the header `x-test-service` into a service principal whose id and reference id are given apart. */
export function withServiceResolver<const App extends TestApp>(app: App): App {
  const point = 'core.principalResolvers';
  return {
    ...app,
    registry: {
      ...app.registry,
      fills: new Map([
        ...app.registry.fills,
        [
          point,
          [
            ...(app.registry.fills.get(point) ?? []),
            { point, module: 'core', bound: false, fill: resolver },
          ],
        ],
      ]),
    },
  };
}

export { serviceHeader };
