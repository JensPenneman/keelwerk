import type { AnyEffect, Carrier, PrincipalResolver, Scope, UserPrincipal } from '@keelwerk/core';
import type { TestApp } from '../../../src/harness/test-app.ts';
import type { TestTenant } from '../../../src/harness/test-tenant.ts';

/** The header a carrier holds a session in: the effects its resolver returns, as JSON. */
const sessionHeader = 'x-slice-session';

const sessionResolver: PrincipalResolver = {
  id: 'slice.session',
  describe: () => ({ scheme: 'apiKey', name: sessionHeader }),
  *resolve(carrier, ctx) {
    const text = carrier.headers?.[sessionHeader];
    if (text === undefined) return null;
    const effects = JSON.parse(text) as readonly AnyEffect[];
    const scope: Scope = ctx.scope;
    const principal: UserPrincipal = {
      kind: 'user',
      subject: 'ada' as UserPrincipal['subject'],
      subjectRef: null,
      subjectAs: () => null,
      scope: {
        backend: scope.level === 'deployment' ? null : scope.backendId,
        tenant: scope.level === 'tenant' ? scope.tenantId : null,
      },
      claims: {},
      roles: [],
      memberships: [],
      via: 'slice.session',
      ref: { resolver: 'slice.session', principalId: 'ada' },
    };
    return { principal, effects };
  },
  // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
  *fromRef() {
    return null;
  },
};

/** The app with a resolver of the module `slice` that returns, for each request, the effects its carrier holds, as an auth session's resolver returns its idle extension. */
export function withSliceSession<const App extends TestApp>(app: App): App {
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
            { point, module: 'slice', bound: false, fill: sessionResolver },
          ],
        ],
      ]),
    },
  };
}

/** The carrier of a request of `ada` through that resolver: the tenant by header and the effects the resolver returns. */
export function sliceSessionCarrier(tenant: TestTenant, effects: readonly AnyEffect[]): Carrier {
  return {
    transport: 'test',
    headers: { 'x-tenant': tenant.id, [sessionHeader]: JSON.stringify(effects) },
  };
}
