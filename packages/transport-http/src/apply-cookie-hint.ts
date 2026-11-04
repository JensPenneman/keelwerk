import type { CookieHint, InvocationSession } from '@keelwerk/core';
import { clearedCookie } from './cleared-cookie.ts';
import { isBrowserRequest } from './is-browser-request.ts';
import { sessionCookie } from './session-cookie.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value after the hint, with the cookies to set on the response. */
export interface CookieHintResult {
  readonly value: unknown;
  readonly setCookies: readonly string[];
}

/**
 * The `http.cookie` hint of section 16.4.10 under S-48: it applies only to a browser request under
 * host-based tenant resolution, then the cookie is set (or cleared) and the `omitFromBody` fields
 * leave the output. Every other request gets the full output and no cookie.
 */
export function applyCookieHint(
  hint: CookieHint | undefined,
  value: unknown,
  session: InvocationSession,
  headers: Readonly<Record<string, string>>,
): CookieHintResult {
  if (
    hint === undefined ||
    session.resolvedBy !== 'hostname' ||
    !isBrowserRequest(headers) ||
    !isRecord(value)
  ) {
    return { value, setCookies: [] };
  }
  const setCookies: string[] = [];
  if (hint.set !== undefined) {
    const token = value[hint.set.from];
    if (typeof token === 'string' && token !== '') {
      const expiry = hint.set.expiresFrom === undefined ? undefined : value[hint.set.expiresFrom];
      const expires = typeof expiry === 'string' ? new Date(expiry) : undefined;
      setCookies.push(
        sessionCookie(
          hint.set.name,
          token,
          expires !== undefined && !Number.isNaN(expires.getTime()) ? expires : undefined,
        ),
      );
    }
  }
  if (hint.clear !== undefined) {
    setCookies.push(clearedCookie(hint.clear.name));
  }
  const omitted = new Set(hint.omitFromBody ?? []);
  const body =
    omitted.size === 0
      ? value
      : Object.fromEntries(Object.entries(value).filter(([name]) => !omitted.has(name)));
  return { value: body, setCookies };
}
