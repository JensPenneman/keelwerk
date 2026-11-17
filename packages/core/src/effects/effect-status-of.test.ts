import { describe, expect, test } from 'vitest';
import { effectStatusOf } from './effect-status-of.ts';

const createdAt = Temporal.Instant.from('2026-11-17T10:00:00Z');
const settledAt = Temporal.Instant.from('2026-11-17T10:05:00Z');

const full = {
  id: 'f2b4c6a0-0000-7000-8000-000000000001',
  type: 'dispatch.ship',
  status: 'succeeded',
  createdAt,
  updatedAt: createdAt,
  version: 3,
  commandId: 'cmd-secret',
  performer: 'external',
  attempts: 2,
  input: { parcel: 'parcel-secret' },
  eventIds: ['evt-1'],
  continuation: 'dispatch.shipped',
  continuationWith: { tracking: 'tracking-secret' },
  key: 'key-secret',
  output: { label: 'label-secret' },
  outputDigest: 'digest',
  settledAt,
  principalResolver: 'auth.session',
  principalId: 'session-1',
};

describe('effectStatusOf', () => {
  test('the view names only its own members', () => {
    const view = effectStatusOf({
      ...full,
      runAt: createdAt,
      deadline: settledAt,
      error: { kind: 'unavailable', code: 'core.effect_deadline' },
    });
    expect(view).toBeDefined();
    expect(Object.keys(view ?? {}).sort()).toEqual(
      ['deadline', 'id', 'requestedAt', 'runAt', 'settledAt', 'status', 'type'].sort(),
    );
    expect(view).toEqual({
      id: full.id,
      type: 'dispatch.ship',
      status: 'succeeded',
      requestedAt: createdAt,
      runAt: createdAt,
      deadline: settledAt,
      settledAt,
    });
  });

  test('a failed or abandoned effect keeps only the code and kind of its error', () => {
    const error = {
      kind: 'unavailable',
      code: 'core.effect_deadline',
      message: 'quoted address',
      retryable: true,
      retryAfter: 30,
      requestId: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
    };
    for (const status of ['failed', 'abandoned']) {
      expect(effectStatusOf({ ...full, status, error })?.error).toEqual({
        kind: 'unavailable',
        code: 'core.effect_deadline',
      });
    }
  });

  test('a stored error without a known kind or a stable code is left out', () => {
    for (const error of [
      { kind: 'odd', code: 'core.effect_deadline' },
      { kind: 'unavailable', code: 'free text' },
      { kind: 'unavailable' },
      'text',
      null,
    ]) {
      expect(effectStatusOf({ ...full, status: 'failed', error })).not.toHaveProperty('error');
    }
  });

  test('a requested or succeeded effect carries no error', () => {
    const error = { kind: 'unavailable', code: 'core.effect_deadline' };
    for (const status of ['requested', 'succeeded']) {
      expect(effectStatusOf({ ...full, status, error })).not.toHaveProperty('error');
    }
  });

  test('a row without a known status or a creation time is no view', () => {
    expect(effectStatusOf({ ...full, status: 'running' })).toBeUndefined();
    expect(effectStatusOf({ ...full, status: undefined })).toBeUndefined();
    expect(effectStatusOf({ ...full, createdAt: undefined })).toBeUndefined();
    expect(effectStatusOf({ ...full, createdAt: '2026-11-17T10:00:00Z' })).toBeUndefined();
    expect(effectStatusOf({ ...full, id: undefined })).toBeUndefined();
    expect(effectStatusOf({ ...full, type: undefined })).toBeUndefined();
  });
});
