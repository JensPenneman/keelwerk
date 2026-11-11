import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { RetryableUnitError } from '../storage/retryable-unit-error.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import { configSecrets } from './config-secrets.ts';
import { defaultRandomSource } from './default-random-source.ts';
import { deriveHkdf } from './derive-hkdf.ts';
import type { DeriveScopeKey } from './derive-scope-key.ts';
import type { ForkableKeyService } from './forkable-key-service.ts';
import { issueSecret } from './issue-secret.ts';
import { createKeyCache } from './key-cache.ts';
import type { KeyServiceOptions } from './key-service-options.ts';
import { overlayScopeKeys } from './overlay-scope-keys.ts';
import { parseSealedValueRef } from './parse-sealed-value-ref.ts';
import { scopeKeyTarget } from './scope-key-target.ts';
import { unwrapKey } from './unwrap-key.ts';
import { verifySecret } from './verify-secret.ts';
import { wrapKey } from './wrap-key.ts';

/**
 * The service over one way of reaching the scope keys. `owned` is the service that opens its own
 * units: it fills the shared cache and shares one creation per key. A service bound to a unit that
 * is open (`within`) only reads the cache, since what that unit holds may still roll back.
 */
function keyServiceOver(
  options: KeyServiceOptions,
  cache: ReturnType<typeof createKeyCache<Uint8Array>>,
  withScopeKeys: KeyServiceOptions['withScopeKeys'],
  owned: boolean,
): ForkableKeyService {
  const random = options.random ?? defaultRandomSource;
  const creating = new Map<string, Promise<Uint8Array>>();

  const load = async (
    target: ReturnType<typeof scopeKeyTarget>,
    create: boolean,
  ): Promise<Uint8Array | undefined> => {
    const read = (): Promise<Uint8Array | 'absent'> =>
      withScopeKeys(async (store) => {
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
      if (owned) cache.set(`${target.level}:${target.scopeId}`, found);
      return found;
    }
    if (!create) return undefined;
    if (!owned) {
      // The key is created in the unit that is open and commits or rolls back with it.
      return withScopeKeys(async (store) => {
        const master = await options.master.current();
        const key = random(32);
        const binding = { level: target.level, scopeId: target.scopeId, version: 1 };
        try {
          await store.add({
            ...binding,
            wrapped: wrapKey(master, binding, key, random),
            createdAt: options.clock.now(),
            retiredAt: null,
          });
        } catch (error) {
          // A concurrent unit created the first key: rerun the unit, which then reads the committed row.
          if (error instanceof KeelwerkError && error.kind === 'conflict') {
            throw new RetryableUnitError('serialization_failure', { cause: error });
          }
          throw error;
        }
        return key;
      });
    }
    const slot = `${target.level}:${target.scopeId}`;
    let pending = creating.get(slot);
    if (pending === undefined) {
      pending = withScopeKeys(async (store) => {
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
    scope: StorageScope,
    create: boolean,
  ): Promise<Uint8Array | undefined> => {
    const target = scopeKeyTarget(scope, options.deploymentId);
    return cache.get(`${target.level}:${target.scopeId}`) ?? (await load(target, create));
  };

  const derive: DeriveScopeKey = async (scope, info, length) => {
    const key = await scopeKey(scope, true);
    if (key === undefined) throw errors.internal('the scope key could not be created');
    return deriveHkdf(key, '', info, length);
  };

  // Opening never creates a key: a text naming a backend without one is `undefined`, not a new key.
  const deriveExisting: DeriveScopeKey = async (scope, info, length) => {
    const key = await scopeKey(scope, false);
    if (key === undefined) throw errors.not_found('the configuration secret is gone');
    return deriveHkdf(key, '', info, length);
  };

  return {
    // The fork overlays the store this view reaches, so a view bound to a unit stays bound to it.
    fork: () => createKeyService({ ...options, withScopeKeys: overlayScopeKeys(withScopeKeys) }),
    within: (store) => keyServiceOver(options, cache, (fn) => fn(store), false),
    async issue(scope, issueOptions) {
      const key = await scopeKey(scope, true);
      if (key === undefined) throw errors.internal('the scope key could not be created');
      return issueSecret(key, issueOptions, random);
    },
    async verify(scope, token, verifier) {
      const key = await scopeKey(scope, false);
      return key !== undefined && verifySecret(key, token, verifier);
    },
    async reveal(unit, ref, reason, expected) {
      if (configSecrets.isText(ref.ref)) {
        options.log?.info('secret revealed', { reason });
        const plain = await configSecrets.open(deriveExisting, ref.ref);
        if (plain === undefined) throw errors.not_found('the configuration secret is gone');
        return plain;
      }
      const sealed = parseSealedValueRef(ref);
      options.log?.info('secret revealed', { reason, keyId: sealed?.keyId });
      const plain = sealed === undefined ? undefined : await unit.keys.openValue(sealed, expected);
      if (plain === undefined) throw errors.not_found('the secret value is gone');
      return new TextDecoder().decode(plain);
    },
    derive,
    invalidate(scope) {
      const target = scopeKeyTarget(scope, options.deploymentId);
      cache.delete(`${target.level}:${target.scopeId}`);
    },
  };
}

/**
 * The key service of 14.7.4. Deployment, backend and tenant keys are random 256-bit keys wrapped
 * under the master key (S-55); rotation re-wraps, so a key's material is stable. Unwrapped keys
 * are cached for 60 seconds. A key created by this call is not cached until it is read back, so
 * a rolled-back creation never leaves a phantom key behind.
 */
export function createKeyService(options: KeyServiceOptions): ForkableKeyService {
  const cache = createKeyCache<Uint8Array>(options.cache);
  return keyServiceOver(options, cache, options.withScopeKeys, true);
}
