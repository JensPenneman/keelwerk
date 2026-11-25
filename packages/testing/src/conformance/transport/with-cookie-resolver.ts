import type { TestApp } from '../../harness/test-app.ts';
import type { TestPrincipalBook } from '../../harness/test-principal-book.ts';
import { testCookieResolver } from './test-cookie-resolver.ts';

/** The app with the test cookie resolver added to the core's resolvers; a subject of `book`'s revoked set has a stale cookie. */
export function withCookieResolver<const App extends TestApp>(
  app: App,
  book?: TestPrincipalBook,
): App {
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
              fill: testCookieResolver(book),
            },
          ],
        ],
      ]),
    },
  };
}
