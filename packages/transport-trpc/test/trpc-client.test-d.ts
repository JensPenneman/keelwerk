import type { AppActionTree, CommandReceipt, ErrorKind, StreamControl } from '@keelwerk/core';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { describe, expectTypeOf, test } from 'vitest';
import { keelwerkSuperjson } from '../src/transformer/keelwerk-superjson.ts';
import type { TrpcFrame } from '../src/types/trpc-frame.ts';
import type { TrpcRouterOf } from '../src/types/trpc-router-of.ts';
import type { TrpcConformanceApp } from './support/trpc-conformance-app.ts';
import type { TrpcRouter } from './support/trpc-conformance-router.ts';
import type { TrpcEventApp } from './support/trpc-event-app.ts';

type Tree = AppActionTree<TrpcConformanceApp>;

const client = createTRPCClient<TrpcRouter>({
  links: [httpBatchLink({ url: 'http://localhost/trpc', transformer: keelwerkSuperjson() })],
});

/** A hand-written app type whose one module has a hyphenated id. */
interface HandApp {
  readonly '~types'?: {
    readonly tree: {
      readonly 'api-keys': {
        readonly actions: {
          readonly mint: {
            readonly kind: 'command';
            readonly input: { readonly label: string };
            readonly output: { readonly key: string };
            readonly errors: never;
            readonly events: never;
            readonly execution: 'sync';
          };
        };
        readonly entities: Record<never, never>;
      };
    };
  };
}

describe('the client of the router type', () => {
  test('a query answers the output of its action', async () => {
    const page = await client.library.book.get.query({ ids: [] });
    expectTypeOf(page.notFound).toEqualTypeOf<readonly string[]>();
    expectTypeOf(page).toEqualTypeOf<Tree['library']['entities']['book']['get']['output']>();
  });

  test('an either command answers its output or the receipt', async () => {
    const answer = await client.loans.lend.mutate({
      bookTitle: 'x',
      dueAt: Temporal.Now.instant(),
    });
    expectTypeOf(answer).toEqualTypeOf<
      CommandReceipt | Tree['loans']['actions']['lend']['output']
    >();
    // @ts-expect-error the output member is not there before the answer is narrowed
    answer.loanId;
  });

  test('a subscription yields items, control frames and tracked ids', () => {
    client.loans.loanEvents.subscribe(
      {},
      {
        onData(data) {
          expectTypeOf(data).toEqualTypeOf<
            TrpcFrame<Tree['loans']['actions']['loanEvents']['output']>
          >();
          expectTypeOf<StreamControl>().toExtend<typeof data>();
        },
      },
    );
  });

  test("a frame narrows by 'data' in frame, once the tracked wrapper is unwrapped", () => {
    type Event = Tree['loans']['actions']['loanEvents']['output'];
    const frame = (value: TrpcFrame<Event>) => {
      const unwrapped = 'id' in value ? value.data : value;
      if ('data' in unwrapped) {
        expectTypeOf(unwrapped.data).toEqualTypeOf<Event>();
        return unwrapped.data;
      }
      expectTypeOf(unwrapped).toEqualTypeOf<StreamControl>();
      return unwrapped.control;
    };
    expectTypeOf(frame).returns.toEqualTypeOf<Event | 'head' | 'reset' | 'gap'>();
    // @ts-expect-error a frame is never the bare event: its members are not at the top level
    const bare: TrpcFrame<Event> = { loanId: 'x', kind: 'created' };
    void bare;
  });

  test('a procedure that does not exist is rejected', () => {
    // @ts-expect-error there is no such module
    client.nobody.get.query({});
    // @ts-expect-error there is no such action
    client.loans.vanish.mutate({});
  });

  test('a command is no query and a query is no command', () => {
    // @ts-expect-error a command has `mutate`, not `query`
    client.loans.lend.query({ bookTitle: 'x', dueAt: Temporal.Now.instant() });
    // @ts-expect-error a query has `query`, not `mutate`
    client.library.book.get.mutate({ ids: [] });
  });

  test('an error carries the wire error of the taxonomy', () => {
    const failure = new TRPCClientError<TrpcRouter>('x');
    expectTypeOf(failure.data?.keelwerk.code).toEqualTypeOf<string | undefined>();
    expectTypeOf(failure.data?.keelwerk.kind).toEqualTypeOf<ErrorKind | undefined>();
  });

  test('without the transformer the wire shows strings where instants were', async () => {
    const plain = createTRPCClient<TrpcRouterOf<TrpcConformanceApp, false>>({
      links: [httpBatchLink({ url: 'http://localhost/trpc' })],
    });
    const page = await plain.library.book.get.query({ ids: [] });
    expectTypeOf(page.list[0]?.createdAt).toEqualTypeOf<string | undefined>();
  });

  test('a json client reads a void event as null, the value the wire carries', () => {
    const plain = createTRPCClient<TrpcRouterOf<TrpcEventApp, false>>({
      links: [httpBatchLink({ url: 'http://localhost/trpc' })],
    });
    plain.pulse.tick.subscribe(undefined, {
      onData(frame) {
        if ('id' in frame || !('data' in frame)) return;
        expectTypeOf(frame.data).toEqualTypeOf<null>();
        const empty = frame.data === null;
        expectTypeOf(empty).toEqualTypeOf<boolean>();
      },
    });
    plain.pulse.maybe.subscribe(undefined, {
      onData(frame) {
        if ('id' in frame || !('data' in frame)) return;
        // @ts-expect-error the value may be null: it is checked before it is used
        frame.data.toUpperCase();
        if (frame.data !== null) frame.data.toUpperCase();
      },
    });
  });

  test('a module id with a hyphen is camel-cased in the path', () => {
    const hand = createTRPCClient<TrpcRouterOf<HandApp>>({
      links: [httpBatchLink({ url: 'http://localhost/trpc', transformer: keelwerkSuperjson() })],
    });
    expectTypeOf(hand.apiKeys.mint.mutate).toBeFunction();
  });
});
