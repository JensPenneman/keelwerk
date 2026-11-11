import { describe, expect, test } from 'vitest';
import { settledEffectDraft } from './settled-effect-draft.ts';

const at = Temporal.Instant.from('2026-01-01T00:00:10Z');
const error = {
  kind: 'unavailable',
  code: 'core.effect_outcome_unknown',
  retryable: false,
  requestId: '0198a1e0-0000-7000-8000-0000000000a1',
} as const;

describe('settledEffectDraft', () => {
  test('a success stores the output, its canonical digest, the attempts and the time', () => {
    expect(settledEffectDraft('e-1', at, { ok: true, value: { ok: true } }, 2)).toEqual({
      kind: 'update',
      type: 'changed',
      target: 'core.effect',
      entity: 'core.effect',
      id: 'e-1',
      values: {
        status: 'succeeded',
        attempts: 2,
        output: { ok: true },
        outputDigest: '4062edaf750fb8074e7e83e0c9028c94e32468a8b6f1614774328ef045150f93',
        settledAt: at,
      },
    });
  });

  test('a failure stores the closed error projection, the attempts and the time', () => {
    expect(settledEffectDraft('e-1', at, { ok: false, error }, 2)).toEqual({
      kind: 'update',
      type: 'changed',
      target: 'core.effect',
      entity: 'core.effect',
      id: 'e-1',
      values: { status: 'failed', attempts: 2, error, settledAt: at },
    });
  });

  test('an abandoned effect has its own status and the same members as a failure', () => {
    expect(settledEffectDraft('e-1', at, { ok: false, error, abandoned: true }, 2)).toEqual({
      kind: 'update',
      type: 'changed',
      target: 'core.effect',
      entity: 'core.effect',
      id: 'e-1',
      values: { status: 'abandoned', attempts: 2, error, settledAt: at },
    });
  });

  test('the draft is frozen', () => {
    expect(Object.isFrozen(settledEffectDraft('e-1', at, { ok: false, error }, 1))).toBe(true);
  });
});
