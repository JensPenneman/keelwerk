import { decoyKeyId } from '../keys/decoy-key-id.ts';
import { openAesGcm } from '../keys/open-aes-gcm.ts';
import type { SealingContext } from './sealing-context.ts';

/** A sealed text that opens to nothing under any key: the decoy a lookup with no row decrypts. */
const decoyNonce = new Uint8Array(12);
const decoyCiphertext = new Uint8Array(32);
const decoyAad = new Uint8Array(0);
const decoyKey = new Uint8Array(32);

/**
 * The key-store work of one found row, done for a lookup that found none (17.2.2, 17.2.5): one
 * read of a key by id through the unit's cache, as `openRow` makes for the row's sealed column, and
 * one failed decryption. What the lookup does on the store then does not tell whether a row exists.
 * Memory answers a miss from a map; the SQL adapters run their select by key id, which returns
 * nothing.
 */
export async function openDecoyColumn(context: SealingContext): Promise<void> {
  await context.keyById(decoyKeyId);
  openAesGcm(decoyKey, decoyNonce, decoyCiphertext, decoyAad);
}
