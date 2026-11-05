import { describe, expect, test } from 'vitest';
import type { AnswerContext } from '../kernel/answer-context.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { SecretRequest } from '../protocol/secret-request.ts';
import { answerSecret } from './answer-secret.ts';

const revealed: string[] = [];
const context = {
  module: 'vault',
  scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
  keys: {
    reveal: async (_unit: unknown, ref: { ref: string }) => {
      revealed.push(ref.ref);
      return 'plain';
    },
  },
} as unknown as AnswerContext;

const stamped = (ref: string, owner: string): object =>
  Object.defineProperty({ ref }, secretRefOwner, { value: owner });

const reveal = (target: unknown) =>
  answerSecret(
    { kind: 'secret', op: 'reveal', args: [target, 'a reason'] } as unknown as SecretRequest,
    context,
  );

describe('reveal accepts only references the requesting module was given (6.6)', () => {
  test('its own decoded reference opens', async () => {
    await expect(reveal(stamped('kwv1.k.AA.BB', 'vault'))).resolves.toBe('plain');
  });

  test("a plain string, a forged object and another module's reference are refused", async () => {
    revealed.length = 0;
    await expect(reveal('kwv1.k.AA.BB')).rejects.toBeDefined();
    await expect(reveal({ ref: 'kwv1.k.AA.BB' })).rejects.toBeDefined();
    await expect(reveal(stamped('kwv1.k.AA.BB', 'auth'))).rejects.toBeDefined();
    expect(revealed).toEqual([]);
  });

  test('a configuration secret opens only for its own backend and module', async () => {
    await expect(reveal({ ref: 'kwc1.b1.vault.key.1.AA.BB' })).resolves.toBe('plain');
    await expect(reveal({ ref: 'kwc1.b2.vault.key.1.AA.BB' })).rejects.toBeDefined();
    await expect(reveal({ ref: 'kwc1.b1.mail.key.1.AA.BB' })).rejects.toBeDefined();
  });
});
