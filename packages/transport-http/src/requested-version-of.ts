import type { KeelwerkError } from '@keelwerk/core';
import { versionConflictOf } from './version-conflict-of.ts';

/**
 * The API version a request of any method names, and the refusal when it names two: the `Keelwerk-Version` header or the
 * `keelwerk-version` query parameter (section 18.3). Naming it in both, or giving the parameter
 * twice, is fine while the values are the same; two different values are a `core.validation`
 * refusal that names them, and no version is named then. A header sent twice arrives joined and
 * is one value that no version matches.
 */
export function requestedVersionOf(request: Request): {
  readonly version: string | null;
  readonly refusal?: KeelwerkError;
} {
  const header = request.headers.get('keelwerk-version');
  const parameters = new URL(request.url).searchParams.getAll('keelwerk-version');
  const named = new Set(header === null ? parameters : [header, ...parameters]);
  if (named.size > 1) return { version: null, refusal: versionConflictOf([...named]) };
  return { version: named.values().next().value ?? null };
}
