import type { ErasureReach } from '../edge/erasure-reach.ts';
import { subjectSpellings } from './subject-spellings.ts';

/**
 * The addresses that are the erased person's, decided once for every use the kernel makes of them.
 * The candidates are what every filler's `addressesOf` answers (a row keeps the text its writer
 * chose, so the filler is asked under every text the subject may be stored as); every filler's
 * `heldByOthers` then names those that a living subject other than the person holds now, and they
 * are dropped. No module's own filtering is relied on for another module's rows or buckets.
 */
export async function personAddresses(
  reaches: readonly { readonly module: string; readonly reach: ErasureReach }[],
  drive: <R>(generator: unknown, module: string) => Promise<R>,
  subjectId: string,
): Promise<readonly string[]> {
  const spellings = subjectSpellings(subjectId);
  const candidates = new Set<string>();
  for (const { module, reach } of reaches) {
    if (reach.addressesOf === undefined) continue;
    for (const spelling of spellings) {
      for (const address of await drive<readonly string[]>(reach.addressesOf(spelling), module)) {
        candidates.add(address);
      }
    }
  }
  if (candidates.size === 0) return [];
  const living = new Set<string>();
  for (const { module, reach } of reaches) {
    if (reach.heldByOthers === undefined) continue;
    const named = await drive<readonly string[]>(
      reach.heldByOthers([...candidates], spellings),
      module,
    );
    for (const address of named) living.add(address);
  }
  return [...candidates].filter((address) => !living.has(address));
}
