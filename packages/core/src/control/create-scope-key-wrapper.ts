import { errors } from '../errors/errors.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { KeyService } from '../kernel/key-service.ts';
import { encodeAad } from '../keys/encode-aad.ts';
import type { ForkableKeyService } from '../keys/forkable-key-service.ts';
import { openAesGcm } from '../keys/open-aes-gcm.ts';
import type { RandomSource } from '../keys/random-source.ts';
import { sealAesGcm } from '../keys/seal-aes-gcm.ts';
import type { ScopeKeyStore } from '../storage/scope-key-store.ts';
import type { ScopeKeyWrapper } from '../storage/scope-key-wrapper.ts';
import type { StorageScope } from '../storage/storage-scope.ts';

function wrapperOver(
  options: {
    readonly directory: () => ScopeLookup;
    readonly deploymentId: string;
    readonly random: RandomSource;
  },
  keys: () => KeyService,
): ScopeKeyWrapper {
  const scopeOf = async (scopeId: string): Promise<StorageScope> => {
    if (scopeId === options.deploymentId) return { level: 'deployment' };
    const directory = options.directory();
    const tenant = await directory.tenant(scopeId);
    if (tenant !== undefined)
      return { level: 'tenant', backendId: tenant.backendId, tenantId: tenant.id };
    if ((await directory.backend(scopeId)) !== undefined)
      return { level: 'backend', backendId: scopeId };
    throw errors.not_found(`No scope ${scopeId} to wrap a key under.`);
  };
  const keyOf = async (scopeId: string): Promise<Uint8Array> =>
    keys().derive(await scopeOf(scopeId), 'keelwerk/key-wrap/1', 32);
  return {
    version: 1,
    wrap: async (scopeId, plain, context) => {
      const sealed = sealAesGcm(
        await keyOf(scopeId),
        plain,
        encodeAad([scopeId, context]),
        options.random,
      );
      return new Uint8Array([...sealed.nonce, ...sealed.ciphertext]);
    },
    unwrap: async (scopeId, wrapped, context) => {
      const opened = openAesGcm(
        await keyOf(scopeId),
        wrapped.subarray(0, 12),
        wrapped.subarray(12),
        encodeAad([scopeId, context]),
      );
      if (opened === undefined)
        throw errors.internal('A wrapped key does not open under its scope.');
      return opened;
    },
  };
}

/**
 * The wrapper the SQL adapters keep subject and value keys with (14.7.4): AES-256-GCM under a key
 * derived from the owning scope's key, the scope id and the key's context bound in as associated
 * data. The key service is read lazily because the adapters are created before it exists.
 */
export function createScopeKeyWrapper(options: {
  readonly keys: () => ForkableKeyService;
  readonly directory: () => ScopeLookup;
  readonly deploymentId: string;
  readonly random: RandomSource;
}): ScopeKeyWrapper {
  return {
    ...wrapperOver(options, () => options.keys()),
    within: (store: ScopeKeyStore) => wrapperOver(options, () => options.keys().within(store)),
  };
}
