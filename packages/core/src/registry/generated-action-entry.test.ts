import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { shelf, shelfApi } from '../../test/version-change-kit.ts';
import { coreApiVersions } from '../core-module/core-api-versions.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import { watchActionOf } from '../invoker/watch-action-of.ts';
import { buildRegistry } from './build-registry.ts';
import { generatedActionEntry } from './generated-action-entry.ts';
import { permissiveSchema } from './permissive-schema.ts';

/** A stand-in for the live module: it generates `watch` for every entity. */
const watcher = makeModule({ id: 'watcher', generates: ['watch'] });
const api = shelfApi();
const withWatch = buildRegistry(appOf([shelf, watcher], { api }));
const without = buildRegistry(appOf([shelf], { api }));

function entryOf(registry: typeof without, ref: string) {
  const found = registry.entities.get(ref);
  if (found === undefined) throw new Error(`no entity ${ref}`);
  return found;
}

describe('the entry of a generated action', () => {
  test("the kernel's watch entry equals the registered one but for the schemas", () => {
    const registered = withWatch.actions.get('shelf.item.watch');
    expect(registered).toBeDefined();
    expect(without.actions.has('shelf.item.watch')).toBe(false);
    const built = watchActionOf(
      { registry: without, head: '2026-11-11', api },
      entryOf(without, 'shelf.item'),
    );
    if (registered === undefined) return;
    const { input: _a, output: _b, handler: _c, ...wanted } = registered;
    const { input: _d, output: _e, handler, ...got } = built;
    expect(got).toEqual(wanted);
    expect(handler).toBe(registered.handler);
    // The members the stage and the rules read.
    expect(got).toMatchObject({ idempotent: true, since: '2026-11-04', resumable: true });
  });

  test('a registered watch is the one the kernel uses', () => {
    const registered = withWatch.actions.get('shelf.item.watch');
    const used = watchActionOf(
      { registry: withWatch, head: '2026-11-11', api },
      entryOf(withWatch, 'shelf.item'),
    );
    expect(used).toBe(registered);
  });

  test("since is the app's first version; a core entity's is the core's first", () => {
    const schemas = { input: permissiveSchema(), output: permissiveSchema() };
    const early = defineApiVersions({ '2026-10-01': {}, '2026-11-11': {} });
    const own = entryOf(without, 'shelf.item');
    expect(generatedActionEntry(own, 'watch', { schemas, api: early, execution: {} }).since).toBe(
      '2026-10-01',
    );
    expect(generatedActionEntry(own, 'watch', { schemas, api: null, execution: {} }).since).toBe(
      coreApiVersions.dates[0],
    );
    const coreEntity = [...without.entities.values()].find((entity) => entity.module === 'core');
    expect(coreEntity).toBeDefined();
    if (coreEntity === undefined) return;
    expect(
      generatedActionEntry(coreEntity, 'watch', { schemas, api: early, execution: {} }).since,
    ).toBe(coreApiVersions.dates[0]);
  });
});
