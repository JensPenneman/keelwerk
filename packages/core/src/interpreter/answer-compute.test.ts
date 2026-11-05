import { describe, expect, test } from 'vitest';
import { argon2idHash } from '../compute/argon2id-hash.ts';
import { argon2idParams } from '../compute/argon2id-params.ts';
import { dummyVerifier } from '../compute/dummy-verifier.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { ComputeRequest } from '../protocol/compute-request.ts';
import { answerCompute } from './answer-compute.ts';

const weaker = argon2idHash('x', new Uint8Array(16), { ...argon2idParams, passes: 1 });
const checked: string[] = [];
const context = {
  unit: {
    keys: {
      openValue: async (sealed: { keyId: string }) =>
        sealed.keyId === 'k-live'
          ? new TextEncoder().encode('$argon2id$real')
          : sealed.keyId === 'k-old'
            ? new TextEncoder().encode(weaker)
            : sealed.keyId === 'k-now'
              ? new TextEncoder().encode(dummyVerifier)
              : undefined,
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

describe('argon2idNeedsRehash against a stored verifier', () => {
  const needs = (verifier: string) =>
    answerCompute(
      { kind: 'compute', op: 'argon2idNeedsRehash', args: [verifier] } as unknown as ComputeRequest,
      context,
    );

  test('compares the parameters of the opened text, not of the sealed one', async () => {
    expect(await needs('kwv1.k-now.AAAA.BBBB')).toBe(false);
    expect(await needs('kwv1.k-old.AAAA.BBBB')).toBe(true);
  });

  test('a bare hash is compared as it is and a verifier whose key is gone is left alone', async () => {
    expect(await needs(dummyVerifier)).toBe(false);
    expect(await needs(weaker)).toBe(true);
    expect(await needs('kwv1.k-gone.AAAA.BBBB')).toBe(false);
  });
});
