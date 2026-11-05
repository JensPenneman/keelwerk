import { KeelwerkError } from './keelwerk-error.ts';

/**
 * The `conflict` an adapter answers for a unique-index violation: it names the violated constraint
 * and marks the conflict `unique`, so the command runner can repeat the unit once and let `decide`
 * see the committed row (sections 7.9 and 14.3).
 */
export function uniqueConflict(constraint: string | undefined, cause: unknown): KeelwerkError {
  return new KeelwerkError({
    kind: 'conflict',
    code: 'core.conflict',
    message: 'A unique value is already taken.',
    details: { unique: true, ...(constraint === undefined ? {} : { constraint }) },
    cause,
  });
}
