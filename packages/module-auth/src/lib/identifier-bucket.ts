import type { NormalizerRegistry } from '@keelwerk/core';

/**
 * The name of the bucket that counts the failed attempts with one identifier, as the credential
 * lookup sees it: the `email` normaliser, so every spelling of one identifier shares one bucket.
 */
export function identifierBucket(identifier: string, registry: NormalizerRegistry): string {
  const email = registry.resolve({ id: 'email', version: 1 });
  return `identifier:${email === undefined ? identifier : email.normalize(identifier)}`;
}
