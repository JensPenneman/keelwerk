import { type InvokeResponse, type KeelwerkError, toWire } from '@keelwerk/core';
import { audienceOf } from './audience-of.ts';
import type { HostContext } from './host-context.ts';
import type { RequestState } from './request-state.ts';

/** The error envelope: the core's `toWire` plus the request id, which only the host knows. */
export function wireErrorOf(
  host: HostContext,
  state: RequestState,
  error: KeelwerkError,
): Extract<InvokeResponse, { ok: false }> {
  return {
    ok: false,
    error: { ...toWire(error, audienceOf(host, state)), requestId: state.requestId },
  };
}
