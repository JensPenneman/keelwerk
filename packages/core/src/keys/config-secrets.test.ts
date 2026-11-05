import { describe, expect, test } from 'vitest';
import { countingRandomSource } from '../../test/keys/counting-random-source.ts';
import { memoryScopeKeys } from '../../test/keys/memory-scope-keys.ts';
import { configSecrets } from './config-secrets.ts';
import { createKeyService } from './create-key-service.ts';

const master = { version: 1, material: new Uint8Array(32).fill(9) };
const clock = { now: () => Temporal.Instant.from('2026-11-05T10:00:00Z') };
const binding = { backendId: 'b1', moduleId: 'mail', field: 'password' };

function setup() {
  const store = memoryScopeKeys();
  const service = createKeyService({
    master: { current: async () => master, byVersion: async () => master },
    deploymentId: 'dep',
    withScopeKeys: store.withScopeKeys,
    clock,
    random: countingRandomSource(),
  });
  return { service, store };
}

describe('configuration secrets (5.7, S-70)', () => {
  test('seal under the backend key, open through the key service and nowhere else', async () => {
    const { service } = setup();
    const derive = (...args: Parameters<typeof service.derive>) => service.derive(...args);
    const text = await configSecrets.seal(derive, binding, 'hunter2');
    expect(text).toMatch(/^kwc1\.b1\.mail\.password\.1\.[^.]+\.[^.]+$/);
    expect(text).not.toContain('hunter2');
    expect(configSecrets.isText(text)).toBe(true);
    expect(configSecrets.parse(text)).toMatchObject({ ...binding, keyVersion: '1' });
    expect(await configSecrets.open(derive, text)).toBe('hunter2');
    expect(await configSecrets.open(derive, text.replace('password', 'user'))).toBeUndefined();
    expect(await configSecrets.open(derive, text.replace('.b1.', '.b2.'))).toBeUndefined();
    expect(await configSecrets.open(derive, text.replace('.1.', '.2.'))).toBeUndefined();
    expect(await configSecrets.open(derive, 'kwc1.nonsense')).toBeUndefined();
    expect(
      await service.reveal({} as never, { ref: text } as never, 'the mail module logs in'),
    ).toBe('hunter2');
  });

  test('revealing a text that names a backend without a key creates no key', async () => {
    const { service, store } = setup();
    const made = 'kwc1.0198c1d0-0000-7000-8000-000000000001.mail.password.1.AAAA.BBBB';
    await expect(
      service.reveal({} as never, { ref: made } as never, 'probe'),
    ).rejects.toMatchObject({ kind: 'not_found' });
    expect(store.rows).toHaveLength(0);
  });

  test('the stored text is final: a fixed master key, key and nonce give this exact text (golden)', async () => {
    const { service } = setup();
    const text = await configSecrets.seal(
      (...args) => service.derive(...args),
      binding,
      'hunter2',
      countingRandomSource(100),
    );
    expect(text).toBe('kwc1.b1.mail.password.1.ZGVmZ2hpamtsbW5v.ol-U4tXIQXAXkVkonPPt33xMpFTWo60');
  });
});
