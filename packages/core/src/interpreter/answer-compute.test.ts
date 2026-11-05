import { describe, expect, test } from 'vitest';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { ComputeRequest } from '../protocol/compute-request.ts';
import { answerCompute } from './answer-compute.ts';

const checked: string[] = [];
const context = {
  unit: {
    keys: {
      openValue: async (sealed: { keyId: string }) =>
        sealed.keyId === 'k-live' ? new TextEncoder().encode('$argon2id$real') : undefined,
    },
  },
  compute: {
    argon2idVerify: async (verifier: string, password: string) => {
      checked.push(verifier);
      return verifier === '$argon2id$real' && password === 'pw';
    },
  },
} as unknown as AnswerContext;

const verify = (verifier: string, password: string) =>
  answerCompute(
    {
      kind: 'compute',
      op: 'argon2idVerify',
      args: [verifier, password],
    } as unknown as ComputeRequest,
    context,
  );

describe('argon2idVerify against a stored verifier', () => {
  test('opens a sealed verifier before checking it', async () => {
    expect(await verify('kwv1.k-live.AAAA.BBBB', 'pw')).toBe(true);
    expect(await verify('kwv1.k-live.AAAA.BBBB', 'wrong')).toBe(false);
    expect(checked.at(-1)).toBe('$argon2id$real');
  });

  test('a verifier whose key is gone never verifies, and a bare hash still checks', async () => {
    expect(await verify('kwv1.k-gone.AAAA.BBBB', 'pw')).toBe(false);
    expect(await verify('$argon2id$real', 'pw')).toBe(true);
  });
});
