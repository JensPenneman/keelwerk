import type { StreamFrame } from '@keelwerk/testing';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(reason: string, event: StreamFrame): Error {
  return new Error(`A malformed oRPC frame: ${reason} (${JSON.stringify(event.data)})`);
}

const known = new Set(['head', 'reset', 'gap']);

/**
 * The suite's frame of one oRPC event, or `'end'` when the event closes the stream (`done`) or
 * `'skip'` for a control frame of a kind this reader does not know. The class of a `message` event
 * depends on the presence of `data` alone: with `data` it is an item whatever the event holds (an
 * item carries only `data` and `id`, and its `id`, or its absence, is the event id); with a string
 * `control` and no `data` it is that control frame (`head`, `reset` or `gap`); both members or
 * neither is malformed and throws. An event id is the state of a head and of a reset that has one,
 * and is absent on a gap, on a reset without a state and on an item without a state: any other
 * event id, and a head without a state, is malformed. `error` is the error's data.
 */
export function orpcFrameOf(event: StreamFrame): StreamFrame | 'end' | 'skip' {
  if (event.event === 'done') return 'end';
  const body = isRecord(event.data) ? event.data : {};
  if (event.event === 'error') {
    const failure = isRecord(body.json) ? body.json.data : undefined;
    return { event: 'error', id: event.id, data: { error: failure } };
  }
  const json: unknown = body.json;
  if (!isRecord(json)) throw malformed('the body is no object', event);
  const hasData = Object.hasOwn(json, 'data');
  const hasControl = Object.hasOwn(json, 'control');
  if (hasData && hasControl) throw malformed('it has both data and control', event);
  if (hasData) {
    const { data, id, ...extra } = json;
    if (Object.keys(extra).length > 0) {
      throw malformed(`an item has the member ${Object.keys(extra).join(', ')}`, event);
    }
    if (id !== event.id) {
      throw malformed('the id of the item differs from the event id', event);
    }
    return { event: 'data', id: event.id, data };
  }
  if (!hasControl) throw malformed('it has neither data nor control', event);
  const { control, ...rest } = json;
  if (typeof control !== 'string') throw malformed('control is no string', event);
  if (!known.has(control)) return 'skip';
  const state = typeof rest.state === 'string' ? rest.state : undefined;
  if (control === 'head' && state === undefined) throw malformed('a head has no state', event);
  if (control === 'head' || (control === 'reset' && state !== undefined)) {
    if (event.id !== state) throw malformed('the event id is not the state of the frame', event);
  } else if (event.id !== undefined) {
    throw malformed(
      `${control === 'gap' ? 'a gap' : 'a reset without a state'} has an event id`,
      event,
    );
  }
  return { event: control, id: event.id, data: rest };
}
