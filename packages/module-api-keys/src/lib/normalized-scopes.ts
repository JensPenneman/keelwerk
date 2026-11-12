import { errors } from '@keelwerk/core';
import type { KeyScope } from './key-scope.ts';

/** The scopes of a new key: distinct and sorted; a key holds `read` or `write`, else the request is invalid. */
export function normalizedScopes(scopes: readonly string[]): readonly KeyScope[] {
  const distinct = [...new Set(scopes)].sort();
  if (!(distinct.includes('read') || distinct.includes('write'))) {
    throw errors.validation('A key holds the read scope or the write scope.');
  }
  return distinct as readonly KeyScope[];
}
