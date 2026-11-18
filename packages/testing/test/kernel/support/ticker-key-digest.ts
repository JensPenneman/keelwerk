import { storedJobKeyDigest } from './stored-job-key-digest.ts';
import type { TickerKit } from './ticker-kit.ts';

/** The digest a job key is stored under in the acme tenant of a ticker kit. */
export function tickerKeyDigest(kit: TickerKit, owner: string, key: string): Promise<string> {
  return storedJobKeyDigest(kit.runtime.keys, kit.scopeOf('acme'), owner, key);
}
