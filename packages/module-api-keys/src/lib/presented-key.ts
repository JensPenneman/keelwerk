import type { Carrier } from '@keelwerk/core';

const bearerPattern = /^Bearer\s+(\S+)$/i;

/** The key a carrier presents: the token the transport extracted, else the `Authorization: Bearer` header. */
export function presentedKey(carrier: Carrier): string | undefined {
  return carrier.token ?? bearerPattern.exec(carrier.headers?.authorization ?? '')?.[1];
}
