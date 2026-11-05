import { describe, expect, test } from 'vitest';
import { countingRandomSource } from '../../test/keys/counting-random-source.ts';
import { memoryScopeKeys } from '../../test/keys/memory-scope-keys.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import { configSecrets } from '../keys/config-secrets.ts';
import { createKeyService } from '../keys/create-key-service.ts';
import type { SecretRequest } from '../protocol/secret-request.ts';
import { replayAnswerers } from './replay-answerers.ts';

const master = { version: 1, material: new Uint8Array(32).fill(7) };
const scope = { level: 'backend', backendId: 'b1' } as const;
const clock = { now: () => Temporal.Instant.from('2026-11-05T10:00:00Z') };

describe('a lost scope key in a re-decide', () => {
  test('answers core.replay_key_destroyed for a configuration secret whose backend key is gone', async () => {
    const store = memoryScopeKeys();
    const keys = createKeyService({
      master: { current: async () => master, byVersion: async () => master },
      deploymentId: 'dep',
      withScopeKeys: store.withScopeKeys,
      clock,
      random: countingRandomSource(),
    });
    const text = await configSecrets.seal(
      (target, info, length) => keys.derive(target, info, length),
      { backendId: 'b1', moduleId: 'vault', field: 'key' },
      'plain',
    );
    const context = { module: 'vault', scope, keys } as unknown as AnswerContext;
    const request = {
      kind: 'secret',
      op: 'reveal',
      args: [{ ref: text }, 'a reason'],
    } as unknown as SecretRequest;
    await expect(replayAnswerers([]).secret(request, context)).resolves.toBe('plain');
    store.rows.length = 0;
    keys.invalidate(scope);
    await expect(replayAnswerers([]).secret(request, context)).rejects.toMatchObject({
      code: 'core.replay_key_destroyed',
    });
  });
});
