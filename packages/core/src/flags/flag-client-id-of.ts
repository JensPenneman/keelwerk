import type { Carrier } from '../invoker/carrier.ts';

const longest = 200;

/** `Keelwerk-Client-Id` (16.8.2): the anonymous targeting key; null when absent, empty or over 200 characters. */
export function flagClientIdOf(carrier: Carrier): string | null {
  const id = carrier.headers?.['keelwerk-client-id'];
  return id === undefined || id === '' || id.length > longest ? null : id;
}
