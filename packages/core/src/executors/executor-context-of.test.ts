import { describe, expect, test } from 'vitest';
import { inertSpan, recordingLogger } from '../../test/executor-kit.ts';
import { executorContextOf } from './executor-context-of.ts';

describe('executorContextOf', () => {
  const context = executorContextOf({
    scope: { level: 'deployment' },
    effect: { id: 'e1', type: 'hooks.post', attempt: 1 },
    config: {},
    secrets: { reveal: () => Promise.resolve('') },
    egress: { fetch: () => Promise.reject(new Error('unused')) },
    log: recordingLogger(),
    trace: inertSpan(),
    signal: new AbortController().signal,
  });

  test('blobs.read and blobs.write reject with not_implemented until M4 (S-130)', async () => {
    const expected = expect.objectContaining({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: 'Blobs arrive with M4.',
    });
    await expect(context.blobs.read('x' as never)).rejects.toEqual(expected);
    await expect(context.blobs.write(new Uint8Array(), 'text/plain')).rejects.toEqual(expected);
  });

  test('the context is frozen', () => {
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.blobs)).toBe(true);
  });
});
