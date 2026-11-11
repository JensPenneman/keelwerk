import { describe, expect, test } from 'vitest';
import { dispatcherSelector } from '../../src/dispatcher/dispatcher-selector.ts';
import { dispatchRegistry } from './support/dispatch-registry.ts';

describe('what the dispatcher reads', () => {
  test('every event when an async reaction observes all', () => {
    expect(dispatcherSelector([dispatchRegistry()])).toEqual({});
  });

  test('else the sorted union of the events the async reactions listen to, inline ones left out', () => {
    const registry = dispatchRegistry();
    // The same registry without its `on: 'all'` reaction: listed events only.
    const listed = {
      ...registry,
      reactions: new Map([...registry.reactions].filter(([, reaction]) => reaction.on !== 'all')),
    };
    expect(dispatcherSelector([listed])).toEqual({ names: ['trace.note.created'] });
    const inlineOnly = {
      ...registry,
      reactions: new Map(
        [...listed.reactions].filter(([, reaction]) => reaction.timing === 'inline'),
      ),
    };
    // An empty list matches nothing: no async reaction, no event read.
    expect(dispatcherSelector([inlineOnly])).toEqual({ names: [] });
    expect(dispatcherSelector([])).toEqual({ names: [] });
  });
});
