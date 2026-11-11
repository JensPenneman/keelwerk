import type { CoreErrorCode } from './core-error-code.ts';
import type { ErrorSpec } from './error-spec.ts';

/** The kind, message and retry override of every code the core registers (sections 10 and 18.8, and gap S-06). */
export const coreErrorCodes: Readonly<Record<CoreErrorCode, ErrorSpec>> = Object.freeze({
  'core.forbidden': { kind: 'forbidden', message: 'The caller is not allowed to do this.' },
  'core.version_mismatch': { kind: 'conflict', message: 'The row changed since it was read.' },
  'core.state_mismatch': {
    kind: 'conflict',
    message: 'The collection changed since the expected state.',
  },
  'core.idempotency_mismatch': {
    kind: 'conflict',
    message: 'The command id was used with a different request.',
  },
  'core.command_in_progress': {
    kind: 'conflict',
    message: 'The command is still running.',
    retryable: true,
  },
  'core.cursor_mismatch': {
    kind: 'validation',
    message: 'The cursor does not belong to this sort order and filter.',
  },
  'core.malformed_request': { kind: 'validation', message: 'The request could not be parsed.' },
  'core.payload_too_large': { kind: 'validation', message: 'The request body is too large.' },
  'core.csrf': { kind: 'forbidden', message: 'The request failed the cross-site request check.' },
  'core.token_scope_mismatch': {
    kind: 'validation',
    message: 'The token belongs to another scope.',
  },
  'core.tenant_not_entered': {
    kind: 'forbidden',
    message: 'The operator has not entered this tenant.',
  },
  'core.live_unavailable': {
    kind: 'unavailable',
    message: 'Live updates are not available in this release.',
  },
  'core.quota_exceeded': {
    kind: 'rate_limited',
    message: 'The quota is exhausted.',
    retryable: false,
  },
  'core.timeout': {
    kind: 'unavailable',
    message: 'The command exceeded its timeout and was rolled back.',
  },
  'core.api_version_invalid': {
    kind: 'validation',
    message: 'The API version is not a date of the form YYYY-MM-DD.',
  },
  'core.api_version_unknown': {
    kind: 'validation',
    message: 'The API version is not a version of this app.',
  },
  'core.api_version_retired': {
    kind: 'not_found',
    message: 'The API version is no longer served.',
  },
  'core.protocol_retired': {
    kind: 'not_found',
    message: 'The protocol major is no longer served.',
  },
  'core.rollout_in_progress': {
    kind: 'unavailable',
    message: 'A rollout is in progress and this process does not know the request.',
  },
  'core.feature_suspended': { kind: 'unavailable', message: 'The feature is suspended.' },
  'core.version_change_failed': { kind: 'internal', message: 'A version transform failed.' },
  'core.feature_disabled': {
    kind: 'forbidden',
    message: 'The feature is not enabled for the caller.',
  },
  'core.rollout_not_finalized': { kind: 'conflict', message: 'The rollout is not finalized.' },
  'core.row_outside_plan': {
    kind: 'internal',
    message: 'A row fell outside the plan of its read.',
  },
  'core.history_compacted': {
    kind: 'not_found',
    message: 'The history before this point was compacted.',
  },
  'core.queue_full': { kind: 'rate_limited', message: 'The queue is full.' },
  'core.command_id_reserved': {
    kind: 'validation',
    message: 'The command id is in the form the kernel reserves for its own commands.',
  },
  'core.process_instance_key_invalid': {
    kind: 'validation',
    message: 'The instance key of a process that holds personal data is not a data subject id.',
  },
  'core.reaction_key_invalid': {
    kind: 'validation',
    message: 'The key of a reaction was empty or failed for the event.',
  },
  'core.job_lease_lost': { kind: 'unavailable', message: 'The job lease was lost.' },
  'core.capability_unplaceable': {
    kind: 'unsupported',
    message: 'No placement offers the required capability.',
  },
  'core.personal_operator': {
    kind: 'unsupported',
    message: 'The personal field does not support this operator.',
  },
  'core.personal_needle_short': {
    kind: 'unsupported',
    message: 'The search text is too short for the personal field.',
  },
  'core.scan_limit': { kind: 'unsupported', message: 'The bounded scan reached its limit.' },
  'core.effect_in_unit': {
    kind: 'internal',
    message: 'An inline effect was requested inside the unit.',
  },
  'core.reaction_depth': { kind: 'internal', message: 'Inline reactions are nested too deeply.' },
  'core.effect_outcome_unknown': {
    kind: 'unavailable',
    message: 'The effect was abandoned and its destination may have acted.',
    retryable: false,
  },
  'core.effect_deadline': {
    kind: 'unavailable',
    message: 'The external effect failed at its deadline.',
    retryable: false,
  },
  'core.effect_output_too_large': {
    kind: 'unsupported',
    message: 'The effect output is larger than 64 KiB; blob references arrive with M4.',
    retryable: false,
  },
  'core.request_not_allowed': {
    kind: 'internal',
    message: 'The request is not allowed or not answered by this release.',
  },
  'core.replay_outside_horizon': {
    kind: 'unsupported',
    message: 'The decision is older than the feed horizon, so its state reads cannot be answered.',
  },
  'core.replay_key_destroyed': {
    kind: 'unsupported',
    message: 'A key the decision used was destroyed, so it cannot be re-decided.',
  },
  'core.ticket_invalid': { kind: 'unauthenticated', message: 'The stream ticket is not valid.' },
  'core.validation': { kind: 'validation', message: 'The input does not match its schema.' },
  'core.unauthenticated': { kind: 'unauthenticated', message: 'A principal is required.' },
  'core.not_found': { kind: 'not_found', message: 'The target does not exist.' },
  'core.conflict': { kind: 'conflict', message: 'The request conflicts with the current state.' },
  'core.reference_missing': {
    kind: 'conflict',
    message: 'The row refers to a target that does not exist.',
  },
  'core.rate_limited': { kind: 'rate_limited', message: 'Too many requests.' },
  'core.not_implemented': {
    kind: 'not_implemented',
    message: 'This module or action is not part of this app.',
  },
  'core.unavailable': { kind: 'unavailable', message: 'The service is unavailable.' },
  'core.unsupported': { kind: 'unsupported', message: 'The plan is not supported.' },
  'core.internal': { kind: 'internal', message: 'An internal error occurred.' },
});
