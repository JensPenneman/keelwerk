import type { CookieHint, InvocationSession } from '@keelwerk/core';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A browser request carries `Sec-Fetch-Site` or `Origin` (S-48). */
function isBrowserRequest(headers: Headers): boolean {
  return headers.has('sec-fetch-site') || headers.has('origin');
}

const attributes = 'Path=/; Secure; HttpOnly; SameSite=Lax';

function setCookie(name: string, value: string, expires: Date | undefined): string {
  const lifetime =
    expires === undefined
      ? ''
      : `; Expires=${expires.toUTCString()}; Max-Age=${Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000))}`;
  return `${name}=${encodeURIComponent(value)}; ${attributes}${lifetime}`;
}

/** The value a cookie hint leaves in the body, and the `Set-Cookie` values it adds. */
export interface CookieHintResult {
  readonly value: unknown;
  readonly setCookies: readonly string[];
}

/**
 * The `http.cookie` hint of section 16.4.10 under S-48: it applies only to a browser request under
 * host-based tenant resolution, then the cookie is set or cleared and the `omitFromBody` fields
 * leave the output. Every other request gets the full output and no cookie, so a REST client
 * receives the token it sends back as a bearer token.
 */
export function applyCookieHint(
  hint: CookieHint | undefined,
  value: unknown,
  session: InvocationSession,
  headers: Headers,
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
        setCookie(
          hint.set.name,
          token,
          expires !== undefined && !Number.isNaN(expires.getTime()) ? expires : undefined,
        ),
      );
    }
  }
  if (hint.clear !== undefined) {
    setCookies.push(
      `${hint.clear.name}=; ${attributes}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`,
    );
  }
  const omitted = new Set(hint.omitFromBody ?? []);
  return {
    value:
      omitted.size === 0
        ? value
        : Object.fromEntries(Object.entries(value).filter(([name]) => !omitted.has(name))),
    setCookies,
  };
}
