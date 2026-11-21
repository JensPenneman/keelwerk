import type { Principal, PrincipalRef, PrincipalResolver, Scope } from '@keelwerk/core';
import type { TestApp } from '@keelwerk/testing';

const prefix = 'test-token.';

function userOf(subject: string, scope: Scope): Principal {
  return {
    kind: 'user',
    subject: subject as never,
    subjectRef: null,
    subjectAs: () => null,
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
    claims: {},
    roles: [],
    memberships: [],
    via: 'test.token',
    ref: { resolver: 'test.token', principalId: subject },
  };
}

/** A bearer resolver for the socket cases: `test-token.<subject>` is that user; any other token is nobody's. */
function tokenResolver(): PrincipalResolver {
  const principalOf = (token: string | undefined, scope: Scope) =>
    token?.startsWith(prefix) === true ? userOf(token.slice(prefix.length), scope) : null;
  return {
    id: 'test.token',
    describe: () => ({ scheme: 'bearer' }),
    // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
    *resolve(carrier, ctx) {
      const principal = principalOf(carrier.token, ctx.scope);
      return principal === null ? null : { principal };
    },
    // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
    *fromRef(ref: PrincipalRef, ctx) {
      const principal = userOf(ref.principalId, ctx.scope);
      return { principal };
    },
  };
}

/** The app with the token resolver added to the core's resolvers, so a socket client can send its credentials in `connectionParams`. */
export function withTokenResolver<const App extends TestApp>(app: App): App {
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
            {
              point: 'core.principalResolvers',
              module: 'core',
              bound: false,
              fill: tokenResolver(),
            },
          ],
        ],
      ]),
    },
  };
}

/** The bearer token the resolver above accepts for `subject`. */
export const tokenOf = (subject: string): string => `${prefix}${subject}`;
