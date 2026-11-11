import { describe, expect, test, vi } from 'vitest';
import {
  actionOf,
  callOf,
  carrier,
  invokerOf,
  registryOf,
  withResolver,
} from '../../test/invoker/invoker-kit.ts';
import { fakeHub, feed, head, itemFrame, withHub } from '../../test/invoker/live-kit.ts';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { shelf, shelfApi } from '../../test/version-change-kit.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import type { StateToken } from '../events/state-token.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { LiveFrame } from './live-frame.ts';

/** Every call of the translate stage, so a test counts what an item went through. */
const translations: { direction: string; lacking: number; value: unknown }[] = [];

vi.mock('./stages/translate.ts', async (original) => {
  const real = await original<typeof import('./stages/translate.ts')>();
  return {
    translate: (
      translation: { readonly lacking: readonly unknown[] } | undefined,
      direction: 'input' | 'output',
      action: Parameters<typeof real.translate>[2],
      value: unknown,
      input?: unknown,
    ) => {
      translations.push({ direction, lacking: translation?.lacking.length ?? 0, value });
      return real.translate(translation as never, direction, action, value, input);
    },
  };
});

describe('an item of a custom subscription and its event shape', () => {
  const run = async (
    action: ReturnType<typeof actionOf>,
    frames: readonly LiveFrame<unknown>[],
  ) => {
    const { hub } = fakeHub(frames);
    const iterator = withHub(hub, [action])
      .subscribe(callOf('doc.feed', {}, { carrier }))
      [Symbol.asyncIterator]();
    return iterator;
  };

  test('a mapped item that does not fit the event shape ends the stream internal', async () => {
    const iterator = await run(feed, [
      head,
      {
        event: { n: 'one' },
        state: (itemFrame(1) as { readonly state: StateToken }).state,
      } as never,
    ]);
    expect(await iterator.next()).toMatchObject({ value: head });
    await expect(iterator.next()).rejects.toMatchObject({ kind: 'internal' });
  });

  test("an item gets its event shape's defaults", async () => {
    const withDefault = actionOf('doc.feed', {
      ...feed,
      output: shape({ n: field.integer(), tag: field.string().default('plain') }),
    });
    const iterator = await run(withDefault, [itemFrame(1)]);
    expect(await iterator.next()).toMatchObject({
      value: { event: { n: 1, tag: 'plain' } },
    });
    await iterator.return?.();
  });
});

describe('an item of a subscription and the API version of its request', () => {
  const change = {
    id: 'doc.feedRename',
    module: 'doc',
    key: 'feedRename',
    since: '1.0.0',
    surface: [{ action: 'doc.feed', renamedFrom: 'doc.stream' }],
    input: {},
    output: {},
    errors: {},
    fixtures: [],
  };
  const api = defineApiVersions({
    '2026-10-01': {},
    '2026-11-01': { changes: ['doc.feedRename'] },
  });

  test('each item is translated once for the session version, control frames are not', async () => {
    translations.length = 0;
    const { hub } = fakeHub([head, itemFrame(1), itemFrame(2)]);
    const registry = withResolver(
      registryOf([feed], { versionChanges: new Map([[change.id, change]]) as never }),
    );
    const app = { registry, head: '2026-11-01', api, liveHub: hub };
    const invoker = invokerOf(registry, {
      apps: new Map([
        ['doc', app],
        ['core', app],
      ]),
    });
    const older = { ...carrier, headers: { ...carrier.headers, 'keelwerk-version': '2026-10-01' } };
    const iterator = invoker
      .subscribe(callOf('doc.stream', {}, { carrier: older }))
      [Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({ value: head });
    // The input translation of the request itself is not an item.
    const outputs = (): unknown[] => translations.filter((one) => one.direction === 'output');
    expect(outputs()).toHaveLength(0);
    await iterator.next();
    await iterator.next();
    expect(outputs()).toEqual([
      { direction: 'output', lacking: 1, value: { n: 1 } },
      { direction: 'output', lacking: 1, value: { n: 2 } },
    ]);
    await iterator.return?.();
  });
});

/** A stand-in for the live module: it generates `watch` for every entity. */
const watcher = makeModule({ id: 'watcher', generates: ['watch'] });

describe('an item of a generated watch and an older API version', () => {
  const older = {
    ...carrier,
    headers: { ...carrier.headers, 'keelwerk-version': '2026-11-04' },
  };
  const held = (type: string, row?: object): LiveFrame<unknown> =>
    ({
      event: {
        type,
        id: 'itm_1',
        version: 2,
        ...(row === undefined ? {} : { cause: 'changed', row }),
      },
      state: 'v2.0.5.aaaaaaaa.bbbbbbbb',
    }) as never;

  test('the row and its $masked list use the names of the opening version, and the other items carry no $masked', async () => {
    const composed = buildRegistry(appOf([shelf, watcher], { api: shelfApi() }));
    const generated = composed.actions.get('shelf.item.watch');
    if (generated === undefined) throw new Error('the stand-in module generates no watch');
    // Open to everyone, so the test reaches the item translation without a rule set.
    const registry = {
      ...composed,
      actions: new Map([
        ...composed.actions,
        ['shelf.item.watch', { ...generated, auth: 'public' as const }],
      ]),
    };
    // The head renamed `title` to `label`, added `size` and dropped `colour`; the hub speaks head names.
    const { hub, calls } = fakeHub([
      head,
      held('changed', { id: 'itm_1', label: 'x', size: 3, $masked: ['note'] }),
      held('changed', { id: 'itm_1', size: 3, $masked: ['label'] }),
      held('removed'),
    ]);
    const app = { registry, head: '2026-11-11', api: shelfApi(), liveHub: hub };
    const invoker = invokerOf(registry, {
      apps: new Map([
        ['doc', app],
        ['core', app],
      ]),
    });
    const iterator = invoker
      .subscribe(callOf('shelf.item.watch', { fields: ['title'] }, { carrier: older }))
      [Symbol.asyncIterator]();
    await iterator.next();
    const [first, second, third] = await Promise.all([
      iterator.next(),
      iterator.next(),
      iterator.next(),
    ]);
    expect(first.value).toMatchObject({
      event: { type: 'changed', row: { id: 'itm_1', title: 'x', $masked: ['colour', 'note'] } },
    });
    expect(JSON.stringify(first.value)).not.toContain('"size"');
    expect(second.value).toMatchObject({
      event: { row: { $masked: ['colour', 'title'] } },
    });
    expect(third.value).toEqual({
      event: { type: 'removed', id: 'itm_1', version: 2 },
      state: 'v2.0.5.aaaaaaaa.bbbbbbbb',
    });
    // The older version's selection reaches the hub under the head names.
    expect(calls[0]?.[2]).toMatchObject({ fields: ['label'] });
    await iterator.return?.();
  });
});
