import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * The error of a replay read the as-of view cannot answer (a page by cursor, a relation
 * condition, a state-history entity): replay's own limit, not a failure of the handler.
 * `redecide` reports it as "cannot re-decide".
 */
export function replayUnsupported(message: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'unsupported',
    code: 'core.unsupported',
    message,
    details: { replay: 'unsupported' },
  });
}
