import type { ApiSurface } from '@keelwerk/core';
import { surfaceCache } from '../surface-cache.ts';
import type { CliHost } from './cli-host.ts';
import type { DeploymentLink } from './deployment-link.ts';
import type { ResolvedProfile } from './resolved-profile.ts';
import { retryUnreachable } from './retry-unreachable.ts';

/** The cache key of a connection: where it points and which selectors it sends. */
function cacheKey(profile: ResolvedProfile): string {
  return [profile.url ?? '', profile.backend ?? '', profile.tenant ?? ''].join('|');
}

export interface LoadSurfaceOptions {
  /** Completion answers from the cache without a network call. */
  readonly offline?: boolean;
  readonly signal?: AbortSignal;
}

/**
 * The surface to build the action routes from: cached by hash and revalidated with
 * `If-None-Match` on every run (section 16.9.1).
 */
export async function loadSurface(
  host: CliHost,
  profile: ResolvedProfile,
  link: DeploymentLink | undefined,
  options: LoadSurfaceOptions = {},
): Promise<ApiSurface | undefined> {
  const cache = surfaceCache(host);
  const key = cacheKey(profile);
  const hash = await cache.hashFor(key);
  const cached = hash === undefined ? undefined : await cache.load(hash);
  if (options.offline === true || link === undefined) {
    return cached;
  }
  const answer = await retryUnreachable(host, options.signal, () =>
    link.surface(
      cached === undefined ? undefined : hash,
      options.signal === undefined ? undefined : { signal: options.signal },
    ),
  );
  if (!answer.modified && cached !== undefined) {
    return cached;
  }
  if (answer.modified) {
    await cache.store(key, answer.surface);
    return answer.surface;
  }
  return undefined;
}
