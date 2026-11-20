import type { LiveFrame } from '@keelwerk/core';

/**
 * The member of a subscription's event union that one frame is (16.6.5). A control frame is its
 * control type with the frame's own members (`StreamHead`, `StreamReset`, `StreamGap`, as before). An
 * item is built from the frame alone: of the event only `item.members` (the item type's fields) are
 * copied, never `__typename` or `state`; then `__typename` is `item.typeName` and `state` the frame's
 * token or null. So no member of an event can stand in for the type name or the resume token.
 */
export function eventMemberOf(
  frame: LiveFrame<unknown>,
  item: { readonly typeName: string; readonly members: readonly string[] },
): Record<string, unknown> {
  if ('control' in frame) {
    switch (frame.control) {
      case 'head':
        return { __typename: 'StreamHead', state: frame.state };
      case 'reset':
        return {
          __typename: 'StreamReset',
          reason: frame.reason,
          ...(frame.state === undefined ? {} : { state: frame.state }),
        };
      case 'gap':
        return {
          __typename: 'StreamGap',
          ...(frame.missed === undefined ? {} : { missed: frame.missed }),
        };
    }
  }
  const event: unknown = frame.event;
  const member: Record<string, unknown> = {};
  if (typeof event === 'object' && event !== null && !Array.isArray(event)) {
    for (const name of item.members) {
      if (name === '__typename' || name === 'state') continue;
      if (Object.hasOwn(event, name)) member[name] = (event as Record<string, unknown>)[name];
    }
  }
  member.__typename = item.typeName;
  member.state = frame.state ?? null;
  return member;
}
