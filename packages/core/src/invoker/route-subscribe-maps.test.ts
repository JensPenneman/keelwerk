import { describe, expect, test } from 'vitest';
import {
  actionOf,
  callOf,
  carrier,
  invokerOf,
  registryOf,
  scope,
  withResolver,
} from '../../test/invoker/invoker-kit.ts';
import { fakeHub, feed, itemFrame, leaf, streamFailure } from '../../test/invoker/live-kit.ts';

describe('invoker.subscribe with a generator map', () => {
  test('a generator map yields a load answered in one read-only unit per item', async () => {
    /** The units opened, with the number of reads each answered: the setup opens units of its own, so the units of the maps are those that read. */
    const units: { readOnly: boolean; reads: number }[] = [];
    const mapUnits = () => units.filter((unit) => unit.reads > 0);
    const stored = [
      { id: 'p1', title: 'first' },
      { id: 'p2', title: 'second' },
    ];
    let reads = 0;
    const adapter = {
      placementId: 'main',
      unit: async (
        _ns: unknown,
        _scope: unknown,
        fn: (unit: object) => Promise<unknown>,
        options?: { readOnly?: boolean },
      ) => {
        const opened = { readOnly: options?.readOnly === true, reads: 0 };
        units.push(opened);
        return fn({
          scope,
          events: { head: async () => 7n },
          rows: {
            find: async () => {
              opened.reads += 1;
              const row = stored[reads++];
              return {
                rows: row === undefined ? [] : [row],
                position: 7n,
                pageInfo: {
                  hasNextPage: false,
                  hasPreviousPage: false,
                  startCursor: null,
                  endCursor: null,
                },
              };
            },
          },
        });
      },
    };
    const mapped = actionOf('doc.feed', {
      ...feed,
      entity: 'doc.post',
      handler: (_input: unknown, ctx: { readonly target: { byId(id: string): unknown } }) => ({
        kind: 'liveSource',
        source: leaf(),
        map: function* (item: { n: number }) {
          const row = (yield* ctx.target.byId(`p${item.n}`) as Generator<
            unknown,
            { title: string }
          >) as { title: string };
          return { n: item.n * 10 + row.title.length };
        },
      }),
    });
    const { hub } = fakeHub([itemFrame(1), itemFrame(2)]);
    const plain = registryOf([mapped]);
    const post = plain.entities.get('doc.post');
    // The loaded rows pass the module's view of the entity, which needs the origin of its fields.
    const registry = {
      ...plain,
      entities: new Map([['doc.post', { ...post, origin: {} }]]),
    } as unknown as typeof plain;
    const invoker = invokerOf(
      withResolver(registry),
      { placement: () => ({ adapter }) as never },
      { liveHub: hub },
    );
    const stream = invoker.subscribe(callOf('doc.feed', {}, { carrier }))[Symbol.asyncIterator]();
    const first = await stream.next();
    // The first item opened one unit that read once, and it is read-only.
    expect(mapUnits()).toEqual([{ readOnly: true, reads: 1 }]);
    const second = await stream.next();
    expect(first.value).toMatchObject({ event: { n: 15 } });
    expect(second.value).toMatchObject({ event: { n: 26 } });
    // The second item opened one more, not the first again.
    expect(mapUnits()).toEqual([
      { readOnly: true, reads: 1 },
      { readOnly: true, reads: 1 },
    ]);
    await stream.return?.();
  });

  test('a generator map that yields a non-request ends the stream with core.request_not_allowed', async () => {
    const adapter = {
      placementId: 'main',
      unit: async (_ns: unknown, _scope: unknown, fn: (unit: object) => Promise<unknown>) =>
        fn({ events: { head: async () => 0n } }),
    };
    const mapped = actionOf('doc.feed', {
      ...feed,
      handler: () => ({
        kind: 'liveSource',
        source: leaf(),
        map: function* () {
          yield 1;
        },
      }),
    });
    const { hub } = fakeHub([itemFrame(1)]);
    const error = await streamFailure(
      invokerOf(
        withResolver(registryOf([mapped])),
        { placement: () => ({ adapter }) as never },
        { liveHub: hub },
      ).subscribe(callOf('doc.feed', {}, { carrier })),
    );
    expect(error).toMatchObject({ kind: 'internal', code: 'core.request_not_allowed' });
  });
});
