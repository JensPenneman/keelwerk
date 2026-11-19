import type { CarrierEndReason, StateToken, WireError } from '@keelwerk/core';
import { clientFailure } from '../client-failure.ts';
import { isRecord } from '../is-record.ts';
import type { LiveLegEvent } from '../live-leg-event.ts';
import type { ServerSentEvent } from './server-sent-event.ts';

const reasons: ReadonlySet<string> = new Set([
  'complete',
  'going_away',
  'max_duration',
  'version_retired',
]);
const resets: ReadonlySet<string> = new Set(['overflow', 'expired', 'resync']);

function parsed(event: ServerSentEvent): unknown {
  try {
    return JSON.parse(event.data) as unknown;
  } catch (cause) {
    throw clientFailure('core.internal', `The ${event.event} event of the stream is not JSON.`, {
      cause,
    });
  }
}

function malformed(event: ServerSentEvent): Error {
  return clientFailure('core.internal', `The ${event.event} event of the stream is malformed.`);
}

/**
 * The events of 15.4.6 as leg events: `data` (the JSON item; its `state` is the non-empty event id),
 * `head`, `reset`, `gap`, `error` and `end`. `welcome`, `notice` and unknown names are undefined. An
 * event whose data is not JSON, or does not have the shape of its name, is a `core.internal` failure.
 */
export function liveLegEventOf(event: ServerSentEvent): LiveLegEvent | undefined {
  switch (event.event) {
    case 'data': {
      const item = parsed(event);
      return {
        kind: 'frame',
        frame: {
          event: item,
          ...(event.id !== undefined && event.id !== '' && { state: event.id as StateToken }),
        },
      };
    }
    case 'head': {
      const body = parsed(event);
      if (!isRecord(body) || typeof body.state !== 'string') throw malformed(event);
      return { kind: 'frame', frame: { control: 'head', state: body.state as StateToken } };
    }
    case 'reset': {
      const body = parsed(event);
      if (!isRecord(body) || typeof body.reason !== 'string' || !resets.has(body.reason)) {
        throw malformed(event);
      }
      return {
        kind: 'frame',
        frame: {
          control: 'reset',
          reason: body.reason as 'overflow' | 'expired' | 'resync',
          ...(typeof body.state === 'string' && { state: body.state as StateToken }),
        },
      };
    }
    case 'gap': {
      const body = parsed(event);
      return {
        kind: 'frame',
        frame: {
          control: 'gap',
          ...(isRecord(body) && typeof body.missed === 'number' && { missed: body.missed }),
        },
      };
    }
    case 'error': {
      const body = parsed(event);
      if (!isRecord(body) || typeof body.code !== 'string' || typeof body.kind !== 'string') {
        throw malformed(event);
      }
      return { kind: 'error', error: body as unknown as WireError };
    }
    case 'end': {
      const body = parsed(event);
      if (!isRecord(body) || typeof body.reason !== 'string' || !reasons.has(body.reason)) {
        throw malformed(event);
      }
      return { kind: 'end', reason: body.reason as CarrierEndReason };
    }
    default:
      return undefined;
  }
}
