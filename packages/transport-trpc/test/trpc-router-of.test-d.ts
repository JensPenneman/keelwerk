import type { CommandReceipt } from '@keelwerk/core';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { describe, expectTypeOf, test } from 'vitest';
import { keelwerkSuperjson } from '../src/transformer/keelwerk-superjson.ts';
import type { TrpcFrame } from '../src/types/trpc-frame.ts';
import type { TrpcRouterOf } from '../src/types/trpc-router-of.ts';
import type { TrpcEventApp } from './support/trpc-event-app.ts';

type Leaf<Kind extends string, Execution extends string | undefined = undefined> = {
  readonly kind: Kind;
  readonly input: { readonly label: string };
  readonly output: { readonly key: string };
  readonly errors: never;
  readonly events: never;
} & (Execution extends string ? { readonly execution: Execution } : unknown);

/** A hand-written app type: a module with entities, and one with none. */
interface HandApp {
  readonly '~types'?: {
    readonly tree: {
      readonly 'api-keys': {
        readonly actions: {
          readonly mint: Leaf<'command', 'sync'>;
          readonly mintLater: Leaf<'command', 'async'>;
        };
        readonly entities: Record<never, never>;
      };
      readonly audit: {
        readonly actions: { readonly note: Leaf<'command', 'sync'> };
      };
    };
  };
}

/** Subscriptions of the three input shapes: a scalar, an object and none. */
interface HandFeedApp {
  readonly '~types'?: {
    readonly tree: {
      readonly feed: {
        readonly actions: {
          readonly byName: {
            readonly kind: 'subscription';
            readonly input: string;
            readonly output: { readonly key: string };
            readonly errors: never;
            readonly events: never;
            readonly execution: undefined;
          };
          readonly byLabel: {
            readonly kind: 'subscription';
            readonly input: { readonly label: string };
            readonly output: { readonly key: string };
            readonly errors: never;
            readonly events: never;
            readonly execution: undefined;
          };
          readonly all: {
            readonly kind: 'subscription';
            readonly input: undefined;
            readonly output: { readonly key: string };
            readonly errors: never;
            readonly events: never;
            readonly execution: undefined;
          };
        };
        readonly entities: Record<never, never>;
      };
    };
  };
}

const hand = createTRPCClient<TrpcRouterOf<HandApp>>({
  links: [httpBatchLink({ url: 'http://localhost/trpc', transformer: keelwerkSuperjson() })],
});

const feed = createTRPCClient<TrpcRouterOf<HandFeedApp>>({
  links: [httpBatchLink({ url: 'http://localhost/trpc', transformer: keelwerkSuperjson() })],
});

describe('the input of a subscription in the router type', () => {
  test('a scalar input stays as it is: a string, never undefined or the resume key', () => {
    type Input = Parameters<typeof feed.feed.byName.subscribe>[0];
    expectTypeOf<Input>().toEqualTypeOf<string>();
    expectTypeOf<string>().toExtend<Input>();
    expectTypeOf<undefined>().not.toExtend<Input>();
    expectTypeOf<{ lastEventId: string }>().not.toExtend<Input>();
  });

  test('an object input gains the resume key', () => {
    type Input = Parameters<typeof feed.feed.byLabel.subscribe>[0];
    expectTypeOf<{ label: string }>().toExtend<Input>();
    expectTypeOf<{ label: string; lastEventId: string | null }>().toExtend<Input>();
    expectTypeOf<undefined>().not.toExtend<Input>();
  });

  test('no input is the resume key alone', () => {
    type Input = Parameters<typeof feed.feed.all.subscribe>[0];
    expectTypeOf<undefined>().toExtend<Input>();
    expectTypeOf<{ lastEventId: string }>().toExtend<Input>();
    expectTypeOf<string>().not.toExtend<Input>();
  });
});

describe('the router type over a hand-written app', () => {
  test('an async command answers the receipt, whatever its output is', async () => {
    expectTypeOf(
      await hand.apiKeys.mintLater.mutate({ label: 'x' }),
    ).toEqualTypeOf<CommandReceipt>();
  });

  test('a sync command answers its output and never the receipt', async () => {
    expectTypeOf(await hand.apiKeys.mint.mutate({ label: 'x' })).toEqualTypeOf<{
      readonly key: string;
    }>();
  });

  test('a module with no entities member still has its actions', async () => {
    expectTypeOf(await hand.audit.note.mutate({ label: 'x' })).toEqualTypeOf<{
      readonly key: string;
    }>();
  });
});

const plainPulse = createTRPCClient<TrpcRouterOf<TrpcEventApp, false>>({
  links: [httpBatchLink({ url: 'http://localhost/trpc' })],
});

const superjsonPulse = createTRPCClient<TrpcRouterOf<TrpcEventApp>>({
  links: [httpBatchLink({ url: 'http://localhost/trpc', transformer: keelwerkSuperjson() })],
});

/** The untracked item of a frame, and the item inside its tracked wrapper (what the client reads). */
type Untracked<F> = Exclude<F, { id: string } | { control: unknown }>;
type TrackedItem<F> = F extends { id: string; data: infer D }
  ? Exclude<D, { control: unknown }>
  : never;

describe('the event of a subscription under the json transformer', () => {
  test('a void event is null in the untracked item and in the tracked one', () => {
    plainPulse.pulse.tick.subscribe(undefined, {
      onData(frame) {
        expectTypeOf<Untracked<typeof frame>>().toEqualTypeOf<{ readonly data: null }>();
        expectTypeOf<TrackedItem<typeof frame>['data']>().toEqualTypeOf<null>();
      },
    });
  });

  test('an optional event is the value or null, never optional or plain', () => {
    plainPulse.pulse.maybe.subscribe(undefined, {
      onData(frame) {
        expectTypeOf<Untracked<typeof frame>>().toEqualTypeOf<{
          readonly data: string | null;
        }>();
        expectTypeOf<TrackedItem<typeof frame>['data']>().toEqualTypeOf<string | null>();
      },
    });
  });

  test('a plain event stays as it is', () => {
    plainPulse.pulse.text.subscribe(undefined, {
      onData(frame) {
        expectTypeOf<Untracked<typeof frame>>().toEqualTypeOf<{ readonly data: string }>();
        expectTypeOf<TrackedItem<typeof frame>['data']>().toEqualTypeOf<string>();
      },
    });
  });

  test('the default router keeps the event as the action types it', () => {
    superjsonPulse.pulse.tick.subscribe(undefined, {
      onData(frame) {
        expectTypeOf(frame).toEqualTypeOf<TrpcFrame<void>>();
      },
    });
    superjsonPulse.pulse.maybe.subscribe(undefined, {
      onData(frame) {
        expectTypeOf(frame).toEqualTypeOf<TrpcFrame<string | undefined>>();
      },
    });
  });
});
