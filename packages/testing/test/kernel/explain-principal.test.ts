import { describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import type { TestApp } from '../../src/harness/test-app.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { setup } from './support/explain-kit.ts';

/** The app with a principal enricher that gives every user the role `auditor`, counting its runs. */
function withRoleEnricher<const App extends TestApp>(
  app: App,
  runs: { count: number } = { count: 0 },
): App {
  const point = 'core.principalEnrichers';
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
            {
              point,
              module: 'core',
              bound: false,
              fill: {
                id: 'test.auditor',
                // biome-ignore lint/correctness/useYield: an enricher with nothing to load
                *enrich(principal: { readonly kind: string }) {
                  runs.count += 1;
                  return { roles: principal.kind === 'user' ? ['auditor'] : [] };
                },
              },
            },
          ],
        ],
      ]),
    },
  };
}

describe('the principal of an explanation', () => {
  test('--as user:<id> carries the roles the enrichers add', async () => {
    const { explain } = await setup(
      'memory',
      {},
      { apps: [withRoleEnricher(withTestResolver(conformanceApp))] },
    );
    const answer = await explain({ mode: 'decision', ref: 'loans.loan.query', as: 'user:ada' });
    expect(answer).toMatchObject({
      ok: true,
      value: { principal: { kind: 'user', id: 'ada', roles: ['auditor'] } },
    });
    const plan = (answer.value as unknown as { plan: { selects: string } }).plan;
    expect(plan.selects).not.toContain('borrower');
  });

  test('--as service:<module>.system is the principal the kernel mints for the module, and the default rule names itself', async () => {
    const { explain } = await setup('memory', {}, { apps: [withTestResolver(conformanceApp)] });
    const own = await explain({
      mode: 'decision',
      ref: 'loans.loan.query',
      as: 'service:loans.system',
    });
    expect(own).toMatchObject({
      ok: true,
      value: {
        allowed: true,
        principal: { kind: 'service', id: 'loans.system' },
        rules: [{ id: 'core.ownModule.loans', effect: 'allow' }],
      },
    });
    // Another module's system principal and a service that only has such an id are no module's principal.
    for (const as of ['service:library.system', 'service:ghost.system']) {
      const refused = await explain({ mode: 'decision', ref: 'loans.loan.query', as });
      expect(refused).toMatchObject({ ok: true, value: { allowed: false } });
    }
  });

  test('--roles adds to the enriched roles', async () => {
    const { explain } = await setup(
      'memory',
      {},
      { apps: [withRoleEnricher(withTestResolver(conformanceApp))] },
    );
    const answer = await explain({
      mode: 'decision',
      ref: 'loans.loan.query',
      as: 'user:ada',
      roles: ['clerk'],
    });
    expect(answer).toMatchObject({
      ok: true,
      value: { principal: { roles: ['auditor', 'clerk'] } },
    });
  });

  test('without an enricher the roles are --roles only', async () => {
    const { explain } = await setup('memory', {}, { apps: [withTestResolver(conformanceApp)] });
    const answer = await explain({ mode: 'decision', ref: 'loans.loan.query', as: 'user:ada' });
    expect(answer).toMatchObject({ ok: true, value: { principal: { roles: [] } } });
    expect((answer.value as unknown as { plan: { selects: string } }).plan.selects).toContain(
      'borrower = "ada"',
    );
  });

  test('a dry run as user:<id> runs with the enriched roles', async () => {
    const { explain } = await setup(
      'memory',
      {},
      { apps: [withRoleEnricher(withTestResolver(conformanceApp))] },
    );
    const answer = await explain({
      mode: 'dry-run',
      ref: 'library.addBook',
      as: 'user:ada',
      input: { title: 'Dune', isbn: 'i-1' },
    });
    expect(answer).toMatchObject({
      ok: true,
      value: { authorization: { principal: { roles: ['auditor'] } } },
    });
  });

  test('--as anonymous opens no enricher unit', async () => {
    const runs = { count: 0 };
    const { explain } = await setup(
      'memory',
      {},
      { apps: [withRoleEnricher(withTestResolver(conformanceApp), runs)] },
    );
    const answer = await explain({ mode: 'decision', ref: 'library.addBook', as: 'anonymous' });
    expect(answer).toMatchObject({
      ok: true,
      value: { principal: { kind: 'anonymous', roles: [] } },
    });
    expect(runs.count).toBe(0);
  });

  test('in production a dry run with --as is refused before any enricher runs', async () => {
    const runs = { count: 0 };
    const app = withRoleEnricher(withTestResolver(conformanceApp), runs);
    const point = 'core.principalEnrichers';
    const throwing = {
      ...app,
      registry: {
        ...app.registry,
        fills: new Map([
          ...app.registry.fills,
          [
            point,
            (app.registry.fills.get(point) ?? []).map((entry) => ({
              ...entry,
              fill: {
                id: 'test.broken',
                // biome-ignore lint/correctness/useYield: an enricher that fails at once
                *enrich(): Generator<never, never> {
                  runs.count += 1;
                  throw new Error('enricher failed');
                },
              },
            })),
          ],
        ]),
      },
    };
    const { explain } = await setup('memory', { environment: 'production' }, { apps: [throwing] });
    const answer = await explain({
      mode: 'dry-run',
      ref: 'library.addBook',
      as: 'user:ada',
      input: { title: 'Dune', isbn: 'i-1' },
    });
    expect(answer).toMatchObject({ ok: false, error: { code: 'core.forbidden' } });
    expect(runs.count).toBe(0);
  });
});
