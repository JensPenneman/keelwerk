import type { LiveClientMessage } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import type { LiveMessageRefusal } from './live-message-refusal.ts';
import { parseInvokeRequest } from './parse-invoke-request.ts';
import { streamTokenOf } from './stream-token-of.ts';
import { subscriptionRefOf } from './subscription-ref-of.ts';

const idPattern = /^[\x21-\x7e]{1,64}$/;
/** The longest value of each member of a hello, in characters. */
const helloLimits = {
  token: 4096,
  backend: 256,
  tenant: 256,
  apiVersion: 32,
  traceparent: 55,
} as const;

type Hello = Extract<LiveClientMessage, { type: 'hello' }>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' && idPattern.test(value) ? value : null;
}

function helloOf(message: Readonly<Record<string, unknown>>): Hello | null {
  const members: Record<string, string> = {};
  for (const [name, limit] of Object.entries(helloLimits)) {
    const value = message[name];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > limit) return null;
    members[name] = value;
  }
  return { type: 'hello', ...members };
}

/**
 * One text message of a client as a `LiveClientMessage` (15.4.7). Null, which the socket answers by
 * closing 4000, for a message that is not JSON, not an object, of an unknown type, with an id that
 * is not 1 to 64 visible ASCII characters, or a hello whose members are not strings within their
 * limits. A subscribe is checked with `subscriptionRefOf` and `streamTokenOf`, an invoke with
 * `parseInvokeRequest`; a failure of those is a `LiveMessageRefusal`, and `presence` (M7) is
 * `core.not_implemented`. No text of the message reaches an error or a log.
 */
export function parseLiveClientMessage(
  text: string,
): LiveClientMessage | LiveMessageRefusal | null {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(message)) return null;
  switch (message.type) {
    case 'hello':
      return helloOf(message);
    case 'ping':
      return { type: 'ping' };
    case 'unsubscribe': {
      const id = idOf(message.id);
      return id === null ? null : { type: 'unsubscribe', id };
    }
    case 'subscribe': {
      const id = idOf(message.id);
      if (id === null) return null;
      try {
        const action = subscriptionRefOf(message.action);
        const after =
          message.after === undefined ? undefined : streamTokenOf(message.after, 'after');
        return {
          type: 'subscribe',
          id,
          action,
          ...(message.input !== undefined && { input: message.input }),
          ...(after !== undefined && { after }),
        };
      } catch (failure) {
        return { type: 'refused', id, answer: 'error', error: asKeelwerkError(failure) };
      }
    }
    case 'invoke': {
      const id = idOf(message.id);
      if (id === null) return null;
      try {
        return { type: 'invoke', id, request: parseInvokeRequest(message.request, ['request']) };
      } catch (failure) {
        return { type: 'refused', id, answer: 'result', error: asKeelwerkError(failure) };
      }
    }
    case 'presence': {
      const id = typeof message.id === 'string' ? idOf(message.id) : null;
      return {
        type: 'refused',
        ...(id !== null && { id }),
        answer: 'error',
        error: coreError('core.not_implemented', { message: 'Presence is not available yet.' }),
      };
    }
    default:
      return null;
  }
}
