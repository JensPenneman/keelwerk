import type { Carrier } from '@keelwerk/core';
import { sessionCookieName } from './session-cookie-name.ts';

const bearerPattern = /^Bearer\s+(\S+)$/i;

function cookieValue(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === sessionCookieName) return value.join('=');
  }
  return undefined;
}

/** A token the carrier holds and where it came from. */
export interface PresentedToken {
  readonly source: 'bearer' | 'cookie';
  readonly token: string;
}

/** The bearer token (the carrier's, else the `Authorization` header) wins over the session cookie (17.2.4 step 1). */
export function presentedToken(carrier: Carrier): PresentedToken | undefined {
  const bearer = carrier.token ?? bearerPattern.exec(carrier.headers?.authorization ?? '')?.[1];
  if (bearer !== undefined) return { source: 'bearer', token: bearer };
  const cookie = cookieValue(carrier.headers?.cookie);
  return cookie === undefined || cookie === '' ? undefined : { source: 'cookie', token: cookie };
}
