import { createHmac } from 'node:crypto';
import { encodeAad, jobKeyInfo } from '@keelwerk/core';
import type { TickerKit } from './ticker-kit.ts';

/**
 * The digest a job key is stored under in the acme tenant of a ticker kit: HMAC-SHA-256 of the
 * module and the key text under the scope's job key secret, computed outside the kernel.
 */
export async function tickerKeyDigest(kit: TickerKit, owner: string, key: string): Promise<string> {
  const secret = await kit.runtime.keys.derive(kit.scopeOf('acme'), jobKeyInfo, 32);
  return createHmac('sha256', secret)
    .update(encodeAad([owner, key]))
    .digest('hex');
}
