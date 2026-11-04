import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RuleMatch } from '../errors/rule-match.ts';

/** What a `forbidden` error is built from: a gate or item verdict. */
export interface Denial {
  readonly rules: readonly RuleMatch[];
  /** The deciding deny rule's reason. */
  readonly reason?: string | undefined;
  readonly action: string;
}

/**
 * The `forbidden` error of a denial (section 8.6): the code `core.forbidden`, the deciding deny
 * rule's reason (also the message), and the matched rule ids, deny rules or the allows that would
 * have had to hold. `toWire` shows the ids to operators and development only.
 */
export function forbiddenError(denial: Denial): KeelwerkError {
  const message = denial.reason ?? `The caller is not allowed to do "${denial.action}".`;
  return new KeelwerkError({
    kind: 'forbidden',
    code: 'core.forbidden',
    message,
    rules: denial.rules,
    ...(denial.reason !== undefined && { reason: denial.reason }),
  });
}
