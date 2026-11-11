import { describe, expect, test } from 'vitest';
import { appOf } from '../../../test/registry-kit.ts';
import { buildRegistry } from '../../registry/build-registry.ts';
import { effectAttempt } from './effect-attempt.ts';

describe('core.effectAttempt', () => {
  test('core.effectAttempt is keyed by core.effect, read as core.effect and keeps its records', () => {
    const entry = buildRegistry(appOf([])).streams.get('core.effectAttempt');
    expect(entry).toMatchObject({ module: 'core', name: 'effectAttempt', readAs: 'core.effect' });
    expect(entry?.key.ref).toEqual({ own: true, entity: 'effect' });
    expect(Object.keys(effectAttempt.record.fields)).toEqual([
      'process',
      'build',
      'attempt',
      'startedAt',
      'endedAt',
      'error',
    ]);
    expect(effectAttempt.retention).toBeUndefined();
    expect(effectAttempt.offload).toBeUndefined();
  });

  const attempt = {
    process: 'mail',
    build: 'b1',
    attempt: 1,
    startedAt: '2026-11-11T10:00:00Z',
    endedAt: '2026-11-11T10:00:01Z',
  };
  const projection = {
    kind: 'unavailable',
    code: 'mail.rejected',
    retryable: true,
    retryAfter: 30,
    requestId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a10',
  };

  test('a failed attempt keeps the error kind, code, retry flag, wait and request id', async () => {
    const checked = await effectAttempt.record['~standard'].validate({
      ...attempt,
      error: projection,
    });
    expect(checked).toEqual({ value: { ...attempt, error: projection } });
  });

  test.each(['message', 'details', 'issues', 'reason', 'rules'])(
    'refuses the error member %s, so no free text reaches the stream',
    async (name) => {
      const checked = await effectAttempt.record['~standard'].validate({
        ...attempt,
        error: { ...projection, [name]: name === 'rules' ? [] : '550 5.1.1 <bob@example.com>' },
      });
      expect(checked.issues).toHaveLength(1);
      expect(JSON.stringify(checked.issues)).not.toContain('bob@example.com');
    },
  );

  test('refuses an error that lacks a member or has a wrong one', async () => {
    const { requestId: _omitted, ...short } = projection;
    for (const error of [
      short,
      { ...projection, kind: 'bogus' },
      { ...projection, retryable: 'yes' },
    ]) {
      const checked = await effectAttempt.record['~standard'].validate({ ...attempt, error });
      expect(checked.issues).not.toBeUndefined();
    }
  });
});
