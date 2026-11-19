import { defineCommand } from '../../dsl/define-command.ts';
import { erasableSubjectPattern } from '../../encryption/erasable-subject-pattern.ts';
import { field } from '../../fields/field.ts';
import { shape } from '../../fields/shape.ts';
import { erasureReasons } from '../../ledger/erasure-reasons.ts';
import { refuseDecoySubject } from '../../subjects/refuse-decoy-subject.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';

/**
 * The `core.eraseSubject` command (section 14.7.5, WP-100): asynchronous, tenant scope, input
 * `{ subjectId, reason }`. The subject is a lower-case UUID or 32 lower-case hex digits (the form auth writes) and the reason one of `erasureReasons`,
 * both checked with the rest of the input before anything is stored (the input check also refuses the reserved decoy subject of a scope, which is no subject to erase), so the receipt, the job and
 * the ledger hold no value an operator typed. A job of this action never runs `decide`: the worker
 * starts the erasure itself (`startErasure`), appends the ledger record and leaves the receipt
 * `accepted` until the events worker has finished the last step. Only `acceptAsyncCommand` starts
 * one, after the rules and the ownership check (`checkErasureGrant`), or the own-subject request of `eraseOwnSubject`, after `checkOwnSubjectErasure`: no effect may name it.
 */
export const eraseSubject: CoreLiteral['actions']['eraseSubject'] = defineCommand(coreBase, {
  scope: 'tenant',
  execution: 'async',
  input: refuseDecoySubject(
    shape({
      subjectId: field.string({
        minLength: 32,
        maxLength: 36,
        pattern: erasableSubjectPattern.source,
      }),
      reason: field.enum(erasureReasons),
    }),
    'subjectId',
  ),
  output: shape({ streams: field.integer() }),
  decide: () => ({ events: [], result: { streams: 0 } }),
});
