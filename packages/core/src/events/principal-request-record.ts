import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { DecisionRequest } from './decision-request.ts';

/**
 * What a decision record seals under its principal's long-lived value key: the request the
 * decision read and the command it belongs to. One key seals the requests of many commands, so
 * the command travels inside the sealed text, and a record copied to another command is refused
 * on opening.
 */
export function principalRequestPlain(commandId: string, read: DecisionRequest): Uint8Array {
  return new TextEncoder().encode(canonicalizeJson({ command: commandId, request: read }));
}
