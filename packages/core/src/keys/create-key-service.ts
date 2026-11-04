import { errors } from '../errors/errors.ts';
import type { KeyService } from '../kernel/key-service.ts';
import { defaultRandomSource } from './default-random-source.ts';
import { deriveHkdf } from './derive-hkdf.ts';
import { issueSecret } from './issue-secret.ts';
import { createKeyCache } from './key-cache.ts';
import type { KeyServiceOptions } from './key-service-options.ts';
import { parseSealedValueRef } from './parse-sealed-value-ref.ts';
import { scopeKeyTarget } from './scope-key-target.ts';
import { unwrapKey } from './unwrap-key.ts';
import { verifySecret } from './verify-secret.ts';
import { wrapKey } from './wrap-key.ts';

/**
 * The key service of 14.7.4. Deployment, backend and tenant keys are random 256-bit keys wrapped
 * under the master key (S-55); rotation re-wraps, so a key's material is stable. Unwrapped keys
 * are cached for 60 seconds. A key created by this call is not cached until it is read back, so
 * a rolled-back creation never leaves a phantom key behind.
 */
export function createKeyService(options: KeyServiceOptions): KeyService {
  const random = options.random ?? defaultRandomSource;
  const cache = createKeyCache<Uint8Array>(options.cache);
  const creating = new Map<string, Promise<Uint8Array>>();

  const load = async (
    target: ReturnType<typeof scopeKeyTarget>,
    create: boolean,
  ): Promise<Uint8Array | undefined> => {
    const read = (): Promise<Uint8Array | 'absent'> =>
      options.withScopeKeys(async (store) => {
        const row = await store.current(target.scopeId);
        if (row === undefined) return 'absent';
        if (row.level !== target.level) {
          throw errors.internal(
            `the key ${row.scopeId} is stored as ${row.level}, not ${target.level}`,
          );
        }
        const key = await unwrapKey(
          row.wrapped,
          { level: row.level, scopeId: row.scopeId, version: row.version },
          (version) => options.master.byVersion(version),
        );
        if (key === undefined) {
          throw errors.internal(`the ${row.level} key ${row.scopeId} cannot be unwrapped`);
        }
        return key;
      });
    const found = await read();
    if (found !== 'absent') {
      cache.set(`${target.level}:${target.scopeId}`, found);
      return found;
    }
    if (!create) return undefined;
    const slot = `${target.level}:${target.scopeId}`;
    let pending = creating.get(slot);
    if (pending === undefined) {
      pending = options
        .withScopeKeys(async (store) => {
          const master = await options.master.current();
          const key = random(32);
          const binding = { level: target.level, scopeId: target.scopeId, version: 1 };
          await store.add({
            ...binding,
            wrapped: wrapKey(master, binding, key, random),
            createdAt: options.clock.now(),
            retiredAt: null,
          });
          return key;
        })
        .catch(async (error: unknown) => {
          // Another process may have created the key first; its row wins.
          const winner = await read();
          if (winner === 'absent') throw error;
          return winner;
        })
        .finally(() => {
          creating.delete(slot);
        });
      creating.set(slot, pending);
    }
    return pending;
  };

  const scopeKey = async (
    scope: Parameters<KeyService['issue']>[0],
    create: boolean,
  ): Promise<Uint8Array | undefined> => {
    const target = scopeKeyTarget(scope, options.deploymentId);
    return cache.get(`${target.level}:${target.scopeId}`) ?? (await load(target, create));
  };

  return {
    async issue(scope, issueOptions) {
      const key = await scopeKey(scope, true);
      if (key === undefined) throw errors.internal('the scope key could not be created');
      return issueSecret(key, issueOptions, random);
    },
    async verify(scope, token, verifier) {
      const key = await scopeKey(scope, false);
      return key !== undefined && verifySecret(key, token, verifier);
    },
    async reveal(unit, ref, reason) {
      const sealed = parseSealedValueRef(ref);
      options.log?.info('secret revealed', { reason, keyId: sealed?.keyId });
      const plain = sealed === undefined ? undefined : await unit.keys.openValue(sealed);
      if (plain === undefined) throw errors.not_found('the secret value is gone');
      return new TextDecoder().decode(plain);
    },
    async derive(scope, info, length) {
      const key = await scopeKey(scope, true);
      if (key === undefined) throw errors.internal('the scope key could not be created');
      return deriveHkdf(key, '', info, length);
    },
    invalidate(scope) {
      const target = scopeKeyTarget(scope, options.deploymentId);
      cache.delete(`${target.level}:${target.scopeId}`);
    },
  };
}
