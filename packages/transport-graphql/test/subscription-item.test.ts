import type { LiveFrame } from '@keelwerk/core';
import { readEventStream } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { eventMemberOf } from '../src/subscriptions/event-member-of.ts';
import { graphqlConformanceVersions } from './support/graphql-conformance-app.ts';
import {
  conformanceSurface,
  graphqlSession,
  mountedGraphql,
  sendGraphql,
} from './support/graphql-kit.ts';

const item = {
  typeName: 'LoansLoanEventsItem',
  members: ['kind', 'loanId', 'state'],
};

describe('the item of a subscription', () => {
  test("an item names its own type and the frame's state whatever its event holds", () => {
    expect(
      eventMemberOf(
        {
          event: {
            __typename: 'StreamReset',
            state: 'v2.forged',
            reason: 'resync',
            kind: 'created',
          },
          state: 'v2.real',
        } as LiveFrame<unknown>,
        item,
      ),
    ).toEqual({ kind: 'created', __typename: 'LoansLoanEventsItem', state: 'v2.real' });
  });

  test('an item without a state answers null for it, never a member of the event', () => {
    expect(
      eventMemberOf({ event: { kind: 'created', state: 'v2.forged' } } as LiveFrame<unknown>, item),
    ).toEqual({ kind: 'created', __typename: 'LoansLoanEventsItem', state: null });
  });

  test('an event that is not an object copies nothing', () => {
    for (const event of ['created', ['created'], null, 7]) {
      expect(eventMemberOf({ event } as LiveFrame<unknown>, item)).toEqual({
        __typename: 'LoansLoanEventsItem',
        state: null,
      });
    }
  });

  test('control frames keep their types and members', () => {
    expect(eventMemberOf({ control: 'head', state: 'v2.a' } as LiveFrame<unknown>, item)).toEqual({
      __typename: 'StreamHead',
      state: 'v2.a',
    });
    expect(
      eventMemberOf(
        { control: 'reset', reason: 'resync', state: 'v2.b' } as LiveFrame<unknown>,
        item,
      ),
    ).toEqual({ __typename: 'StreamReset', reason: 'resync', state: 'v2.b' });
    expect(
      eventMemberOf({ control: 'reset', reason: 'resync' } as LiveFrame<unknown>, item),
    ).toEqual({
      __typename: 'StreamReset',
      reason: 'resync',
    });
    expect(eventMemberOf({ control: 'gap', missed: 9 } as LiveFrame<unknown>, item)).toEqual({
      __typename: 'StreamGap',
      missed: 9,
    });
  });

  test("over the schema, an event's own __typename and state never reach the client", async () => {
    // The wire encoding of a shape keeps the shape's own members only, so the forged members below are
    // dropped before the resolver; the item still answers its type and the frame's token alone.
    const surface = conformanceSurface();
    const { handler } = await mountedGraphql(surface, () => ({ ok: true, value: undefined }), {
      subscribe: async function* () {
        yield { control: 'head', state: 'v2.a' } as LiveFrame<unknown>;
        yield {
          event: {
            kind: 'created',
            loanId: '0198a1e0-0000-7000-8000-000000000001',
            __typename: 'StreamReset',
            state: 'v2.forged',
          },
        } as LiveFrame<unknown>;
        yield {
          event: {
            kind: 'closed',
            loanId: '0198a1e0-0000-7000-8000-000000000002',
            __typename: 'StreamReset',
            state: 'v2.forged',
          },
          state: 'v2.real',
        } as LiveFrame<unknown>;
      },
    });
    const response = await sendGraphql(
      handler,
      {
        query:
          'subscription { loansLoanEvents { __typename ... on StreamReset { reason state } ... on LoansLoanEventsItem { kind state } } }',
      },
      {
        headers: { accept: 'text/event-stream' },
        session: graphqlSession({ app: surface.app, apiVersion: graphqlConformanceVersions.head }),
      },
    );
    const reader = readEventStream(response);
    const frames = await reader.until((frame) => frame.event === 'complete', 30_000);
    const results = frames
      .filter((frame) => frame.event === 'next')
      .map(
        (frame) =>
          (frame.data as { data: { loansLoanEvents: Record<string, unknown> } }).data
            .loansLoanEvents,
      );
    expect(results.slice(1)).toEqual([
      { __typename: 'LoansLoanEventsItem', kind: 'CREATED', state: null },
      { __typename: 'LoansLoanEventsItem', kind: 'CLOSED', state: 'v2.real' },
    ]);
  }, 120_000);
});
