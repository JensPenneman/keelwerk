import type { WireError } from '@keelwerk/core';
import { asKeelwerkError } from '@keelwerk/core/http';
import type { LiveSocketState } from './live-socket-state.ts';
import { wireErrorOf } from './wire-error-of.ts';

/** The error of a failure as the socket shows it: the public projection for the socket's current session (operators and development see the detail), with the upgrade's request id. */
export function socketWireError(state: LiveSocketState, failure: unknown): WireError {
  const { host, state: request } = state.upgrade;
  return wireErrorOf(host, { ...request, session: state.session }, asKeelwerkError(failure)).error;
}
