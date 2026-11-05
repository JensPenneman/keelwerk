import { KeelwerkError } from '../errors/keelwerk-error.ts';

/** `core.personal_operator`: a comparison the personal field's declared capabilities cannot answer (14.7.9.4). Nothing falls back silently. */
export function personalOperatorError(
  entity: string,
  field: string,
  op: string,
  why: string,
): KeelwerkError {
  return new KeelwerkError({
    kind: 'unsupported',
    code: 'core.personal_operator',
    message: `${entity}.${field}: the personal field does not support ${op} (${why}).`,
    issues: [{ path: [field], message: `${op}: ${why}` }],
  });
}
