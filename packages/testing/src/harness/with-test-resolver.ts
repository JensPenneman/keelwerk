import type { TestApp } from './test-app.ts';
import { testPrincipalResolver } from './test-principal-resolver.ts';

/** The app with the test principal resolver added to the core's resolvers, so a carrier can hold its principal as plain data; `operators` lets the claim `operator: true` make it an operator. */
export function withTestResolver<const App extends TestApp>(app: App, operators = false): App {
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
              fill: testPrincipalResolver(operators),
            },
          ],
        ],
      ]),
    },
  };
}
