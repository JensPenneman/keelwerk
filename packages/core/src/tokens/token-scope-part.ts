import { sha256 } from '../crypto/sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { Scope } from '../storage/scope.ts';

/**
 * The `scope` part of a state token (section 15.2.6): the first 8 hexadecimal characters of
 * SHA-256 over the backend id and the scope id. It names no namespace, so a token survives a
 * tenant move. A tenant's scope id is the tenant id, a backend's is the backend id, the
 * deployment's is the empty string.
 */
export function tokenScopePart(scope: Scope): string {
  const [backendId, scopeId] =
    scope.level === 'tenant'
      ? [scope.backendId, scope.tenantId]
      : scope.level === 'backend'
        ? [scope.backendId, scope.backendId]
        : ['', ''];
  return sha256(canonicalizeJson([backendId, scopeId])).slice(0, 8);
}
