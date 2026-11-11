import { describe, expect, test } from 'vitest';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { kernelJobError } from './kernel-job-error.ts';

const declared = new Set(['ticker.refused']);

describe('the error a failed kernel job keeps', () => {
  test('the message names the subject and the projected code', () => {
    const failure = new KeelwerkError({
      kind: 'validation',
      code: 'ticker.refused',
      message: 'ada@example.org is not welcome',
      details: { mail: 'ada@example.org' },
    });
    for (const subject of ['reaction', 'timer', 'schedule'] as const) {
      const error = kernelJobError(failure, declared, subject);
      expect(error).toMatchObject({
        kind: 'validation',
        code: 'ticker.refused',
        message: `The ${subject} failed with ticker.refused.`,
      });
      expect(error.details).toBeUndefined();
    }
  });

  test('an undeclared code becomes core.<kind>', () => {
    const foreign = new KeelwerkError({ kind: 'conflict', code: 'other.taken', message: 'x' });
    expect(kernelJobError(foreign, declared, 'schedule')).toMatchObject({
      kind: 'conflict',
      code: 'core.conflict',
      message: 'The schedule failed with core.conflict.',
    });
    expect(kernelJobError(new Error('boom'), declared, 'timer')).toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      message: 'The timer failed with core.internal.',
    });
  });

  test('a lost lease keeps its code', () => {
    const lost = errors.internal('lost');
    expect(kernelJobError(lost, declared, 'timer').kind).toBe('internal');
  });
});
