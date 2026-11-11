import { describe, expect, test } from 'vitest';
import { runChangeFixtures } from '../src/api-versions/run-change-fixtures.ts';
import { buildRegistry } from '../src/registry/build-registry.ts';
import { m2Parts } from './fixtures/modules/m2-parts/src/module.generated.ts';
import { appOf } from './registry-kit.ts';
import { shelfApp } from './version-change-kit.ts';

describe('the change fixtures', () => {
  test('the m2-parts change fixtures pass', async () => {
    const app = appOf([m2Parts]);
    const registry = buildRegistry(app);
    expect([...registry.versionChanges.keys()]).toEqual(['m2-parts.displayName']);
    expect(await runChangeFixtures(registry, app.api)).toEqual([]);
  });

  test('a fixture that does not hold is reported with its change, ref and position', async () => {
    const { app, registry } = shelfApp();
    const base = registry.versionChanges.get('shelf.labelRename');
    if (base === undefined) throw new Error('missing change');
    const failures = await runChangeFixtures(
      {
        ...registry,
        versionChanges: new Map([
          [
            base.id,
            {
              ...base,
              fixtures: [
                { ref: 'shelf.item.create', older: { title: 'a' }, newer: { label: 'a' } },
                { ref: 'shelf.item.create', older: { title: 'a' }, newer: { label: 'b' } },
                { ref: 'shelf.item.create', older: { title: 'a' }, newer: { label: 'a', size: 1 } },
                { ref: 'shelf.nothing', older: {}, newer: {} },
              ],
            },
          ],
        ]),
      },
      app.api,
    );
    expect(failures.map((failure) => [failure.change, failure.ref, failure.index])).toEqual([
      ['shelf.labelRename', 'shelf.item.create', 1],
      ['shelf.labelRename', 'shelf.item.create', 2],
      ['shelf.labelRename', 'shelf.nothing', 3],
    ]);
  });
});
