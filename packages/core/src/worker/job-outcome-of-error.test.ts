import { describe, expect, test } from 'vitest';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import { jobOutcomeOfError } from './job-outcome-of-error.ts';

const now = Temporal.Instant.from('2026-01-01T00:00:00Z');
const random = (): number => 0.5;

function job(over: Partial<StoredJob> = {}, attempt = 1): StoredJob {
  return {
    id: '1',
    kind: 'action',
    queue: 'commands',
    run: { action: 'library.slow', input: {} },
    scope: { level: 'backend', backendId: 'b-1' },
    principal: { resolver: 'test.principal', principalId: 'ada' },
    causation: {},
    build: { id: 'b', revision: 1 },
    laneCap: 4,
    createdAt: now,
    runAt: now,
    attempt: { jobId: '1', attempt },
    ...over,
  };
}

describe('jobOutcomeOfError', () => {
  test.each([
    ['unavailable', errors.unavailable('down')],
    ['rate_limited', errors.rate_limited('slow down')],
    [
      'a retryable conflict',
      new KeelwerkError({
        kind: 'conflict',
        code: 'core.version_mismatch',
        message: 'x',
        retryable: true,
      }),
    ],
  ])('%s is retried inside the policy bound', (_name, error) => {
    const outcome = jobOutcomeOfError(error, job(), now, random);
    expect(outcome?.kind).toBe('retry');
    if (outcome?.kind !== 'retry') return;
    expect(Temporal.Instant.compare(outcome.at, now)).toBeGreaterThanOrEqual(0);
    expect(outcome.at.since(now).total('millisecond')).toBeLessThanOrEqual(1000);
    expect(outcome.error.requestId).toBe('');
  });

  test.each([
    ['validation', errors.validation('bad')],
    ['forbidden', errors.forbidden('no')],
    ['unauthenticated', errors.unauthenticated('who')],
    ['internal', errors.internal('boom')],
    ['a plain error', new Error('boom')],
    ['a conflict that is not retryable', errors.conflict('stale')],
    [
      'a rate limit that is not retryable',
      new KeelwerkError({
        kind: 'rate_limited',
        code: 'core.quota_exceeded',
        message: 'x',
        retryable: false,
      }),
    ],
  ])('%s gives up at once', (_name, error) => {
    expect(jobOutcomeOfError(error, job(), now, random)?.kind).toBe('failed');
  });

  test('a job with a deadLetter ends dead, one without ends failed', () => {
    expect(
      jobOutcomeOfError(errors.validation('x'), job({ deadLetter: 'mail-dead' }), now, random)
        ?.kind,
    ).toBe('dead');
    expect(jobOutcomeOfError(errors.validation('x'), job(), now, random)?.kind).toBe('failed');
  });

  test('the attempts of the policy run out', () => {
    expect(jobOutcomeOfError(errors.unavailable('x'), job({}, 3), now, random)?.kind).toBe(
      'failed',
    );
    expect(
      jobOutcomeOfError(errors.unavailable('x'), job({ deadLetter: 'd' }, 3), now, random)?.kind,
    ).toBe('dead');
  });

  test('retryAfter raises the time of the next attempt', () => {
    const outcome = jobOutcomeOfError(
      errors.rate_limited('slow', { retryAfter: 30 }),
      job(),
      now,
      random,
    );
    expect(outcome?.kind === 'retry' && outcome.at.since(now).total('second')).toBe(30);
  });

  test('a passed giveUpAfter gives up although attempts remain', () => {
    const retry = { delays: 'exponential', giveUpAfter: 'PT1H' } as const;
    const late = now.add({ hours: 2 });
    expect(jobOutcomeOfError(errors.unavailable('x'), job({ retry }), late, random)?.kind).toBe(
      'failed',
    );
    expect(jobOutcomeOfError(errors.unavailable('x'), job({ retry }), now, random)?.kind).toBe(
      'retry',
    );
  });

  test('a lost lease completes nothing', () => {
    const lost = new KeelwerkError({
      kind: 'unavailable',
      code: 'core.job_lease_lost',
      message: 'lost',
    });
    expect(jobOutcomeOfError(lost, job(), now, random)).toBeUndefined();
  });

  test('the stored error is the public form', () => {
    const outcome = jobOutcomeOfError(errors.internal('secret detail'), job(), now, random);
    expect(outcome?.kind === 'failed' && outcome.error.message).not.toContain('secret');
  });
});
