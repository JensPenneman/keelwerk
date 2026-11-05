import { coreError } from '@keelwerk/core/http';

function tagsOf(value: string, weak: boolean): readonly string[] {
  return value
    .split(',')
    .map((tag) => (weak ? tag.trim().replace(/^W\//, '') : tag.trim()))
    .filter((tag) => tag !== '');
}

/**
 * Reads the preconditions of a request. `If-Match` must carry one version as an entity tag (or
 * `*`, which asks for nothing); a weak tag, which strong comparison (RFC 9110 13.1.1) never matches, and anything else is a malformed request.
 */
export function readPreconditions(headers: Headers): Preconditions {
  const noneMatch = tagsOf(headers.get('if-none-match') ?? '', true);
  const ifMatch = headers.get('if-match');
  if (ifMatch === null) {
    return { ifNoneMatch: noneMatch };
  }
  const tags = tagsOf(ifMatch, false);
  if (tags.length === 1 && tags[0] === '*') {
    return { ifNoneMatch: noneMatch };
  }
  const tag = tags.length === 1 ? /^"(\d+)"$/.exec(tags[0] ?? '') : null;
  const version = tag?.[1] === undefined ? Number.NaN : Number(tag[1]);
  if (!Number.isSafeInteger(version)) {
    throw coreError('core.malformed_request', {
      message: 'If-Match must carry exactly one row version as an entity tag.',
    });
  }
  return { ifVersion: version, ifNoneMatch: noneMatch };
}

/** What `If-Match` and `If-None-Match` ask for (section 16.4.9). */
export interface Preconditions {
  /** `If-Match: "<version>"` becomes the instance command's `ifVersion`. */
  readonly ifVersion?: number;
  /** The entity tags of `If-None-Match`; `*` matches any row. */
  readonly ifNoneMatch: readonly string[];
}
