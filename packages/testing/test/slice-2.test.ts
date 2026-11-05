import { memoryAdapter } from '@keelwerk/data';
import { afterAll, describe, expect, test } from 'vitest';
import { pgliteFactory } from '../src/harness/pglite-factory.ts';
import { runScenario } from './support/run-scenario.ts';
import { slice2 } from './support/slice-2.ts';
import { tamperedPlanner } from './support/tampered-planner.ts';

describe.each([
  ['in-memory', () => memoryAdapter()],
  ['PGlite', () => pgliteFactory()],
] as const)(
  'slice 2 on %s through startRuntime with the committed migration files',
  (_name, make) => {
    const kit = slice2({ factory: make(), volatile: true });
    afterAll(() => kit.adapters.closeAll());

    test('the release step applies the committed files, then production starts and runs the scenario', {
      timeout: 120_000,
    }, async () => {
      const release = await kit.boot('test');
      await release.stop(1000);
      const history = await kit.adapters.adapter('main').schema.history(kit.adapters.namespace());
      expect(history.map((entry) => `${entry.track}/${entry.id}`)).toEqual([
        'library/0001-initial',
        'library/0002-related-to',
      ]);

      const runtime = await kit.boot('production');
      try {
        await runScenario(kit, runtime);
      } finally {
        await runtime.stop(1000);
      }
    });

    test('production refuses to start when an applied file has changed', {
      timeout: 120_000,
    }, async () => {
      await (await kit.boot('test')).stop(1000);
      await expect(kit.boot('production', tamperedPlanner())).rejects.toMatchObject({
        kind: 'conflict',
        message: expect.stringMatching(/library 0001-initial changed after it was applied/),
      });
    });
  },
);
