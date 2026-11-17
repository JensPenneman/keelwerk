import type { TestApp } from '../../harness/test-app.ts';
import type { TestPrincipalBook } from '../../harness/test-principal-book.ts';
import { testRevocationResolver } from './test-revocation-resolver.ts';

/** The app with the revocation resolver in front of the core's resolvers, so a subject the book revoked is refused on every later open of its session. */
export function withRevocation<const App extends TestApp>(app: App, book: TestPrincipalBook): App {
  return {
    ...app,
    registry: {
      ...app.registry,
      fills: new Map([
        ...app.registry.fills,
        [
          'core.principalResolvers',
          [
            {
              point: 'core.principalResolvers',
              module: 'core',
              bound: false,
              fill: testRevocationResolver(book),
            },
            ...(app.registry.fills.get('core.principalResolvers') ?? []),
          ],
        ],
      ]),
    },
  };
}
