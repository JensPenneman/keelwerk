import { describe, expect, it } from 'vitest';
import { coreErrorCodes } from './core-error-codes.ts';

describe('coreErrorCodes', () => {
  it('registers 48 codes, all core-prefixed with a message', () => {
    const entries = Object.entries(coreErrorCodes);
    expect(entries).toHaveLength(48);
    for (const [code, spec] of entries) {
      expect(code).toMatch(/^core\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
      expect(spec.message).not.toBe('');
    }
  });

  it('registers core.request_not_allowed as internal (S-06)', () => {
    expect(coreErrorCodes['core.request_not_allowed'].kind).toBe('internal');
  });

  it('keeps the kinds of sections 10 and 18.8', () => {
    expect(coreErrorCodes['core.timeout']).toMatchObject({ kind: 'unavailable' });
    expect(coreErrorCodes['core.version_mismatch'].kind).toBe('conflict');
    expect(coreErrorCodes['core.queue_full'].kind).toBe('rate_limited');
    expect(coreErrorCodes['core.scan_limit'].kind).toBe('unsupported');
    expect(coreErrorCodes['core.quota_exceeded'].retryable).toBe(false);
  });

  it('keeps the full table of code, kind and retryable', () => {
    const table = Object.entries(coreErrorCodes).map(([code, spec]) => [
      code,
      spec.kind,
      spec.retryable ?? (spec.kind === 'unavailable' || spec.kind === 'rate_limited'),
    ]);
    expect(table).toEqual([
      ['core.forbidden', 'forbidden', false],
      ['core.version_mismatch', 'conflict', false],
      ['core.state_mismatch', 'conflict', false],
      ['core.idempotency_mismatch', 'conflict', false],
      ['core.command_in_progress', 'conflict', true],
      ['core.cursor_mismatch', 'validation', false],
      ['core.malformed_request', 'validation', false],
      ['core.payload_too_large', 'validation', false],
      ['core.csrf', 'forbidden', false],
      ['core.token_scope_mismatch', 'validation', false],
      ['core.tenant_not_entered', 'forbidden', false],
      ['core.live_unavailable', 'unavailable', true],
      ['core.quota_exceeded', 'rate_limited', false],
      ['core.timeout', 'unavailable', true],
      ['core.api_version_invalid', 'validation', false],
      ['core.api_version_unknown', 'validation', false],
      ['core.api_version_retired', 'not_found', false],
      ['core.protocol_retired', 'not_found', false],
      ['core.rollout_in_progress', 'unavailable', true],
      ['core.feature_suspended', 'unavailable', true],
      ['core.version_change_failed', 'internal', false],
      ['core.feature_disabled', 'forbidden', false],
      ['core.rollout_not_finalized', 'conflict', false],
      ['core.row_outside_plan', 'internal', false],
      ['core.history_compacted', 'not_found', false],
      ['core.queue_full', 'rate_limited', true],
      ['core.job_lease_lost', 'unavailable', true],
      ['core.capability_unplaceable', 'unsupported', false],
      ['core.personal_operator', 'unsupported', false],
      ['core.personal_needle_short', 'unsupported', false],
      ['core.scan_limit', 'unsupported', false],
      ['core.effect_in_unit', 'internal', false],
      ['core.reaction_depth', 'internal', false],
      ['core.effect_outcome_unknown', 'unavailable', false],
      ['core.effect_deadline', 'unavailable', false],
      ['core.request_not_allowed', 'internal', false],
      ['core.replay_outside_horizon', 'unsupported', false],
      ['core.replay_key_destroyed', 'unsupported', false],
      ['core.validation', 'validation', false],
      ['core.unauthenticated', 'unauthenticated', false],
      ['core.not_found', 'not_found', false],
      ['core.conflict', 'conflict', false],
      ['core.reference_missing', 'conflict', false],
      ['core.rate_limited', 'rate_limited', true],
      ['core.not_implemented', 'not_implemented', false],
      ['core.unavailable', 'unavailable', true],
      ['core.unsupported', 'unsupported', false],
      ['core.internal', 'internal', false],
    ]);
  });
});
