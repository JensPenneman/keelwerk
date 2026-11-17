import { normalizeRule } from '../authorization/normalize-rule.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';

/**
 * The only rule a status view is compiled from: allow `watch` on `core.effect`, every row, any
 * principal; id `core.effectStatus`, module `core`. The ids bound the rows, the submitter condition
 * after the hub decides what is shown; the action's own rule decides who may follow.
 */
export function effectStatusRule(): NormalizedRule {
  return normalizeRule({
    id: 'core.effectStatus',
    module: 'core',
    effect: 'allow',
    subject: { module: 'core', entity: 'effect' },
    actions: ['watch'],
    disabled: false,
  });
}
