import { sha256 } from '../crypto/sha256.ts';
import { plainJsonProblem } from '../flags/plain-json-problem.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';

/**
 * The digest a process state cache is built from (S-124): SHA-256, as hexadecimal text, of the
 * canonical JSON of the build id, the process id, its event names in order of name, its `initial`
 * state and the source text of its `evolve`. A cache is used only for the same digest, so a new
 * build, an edited `evolve`, another `initial` or another set of events starts every instance from
 * its stream. A change only in a helper `evolve` calls is not in the text and is not seen: the
 * caller adds a per-run nonce to `build` in development, and in production a deploy that changes
 * such code keeps the cache until the module version (so the build id) changes.
 * `undefined` (no cache is read or written) when `evolve` is missing, when its text is no code of
 * its own (a bound or native function stringifies to `[native code]` whatever it is bound to), or
 * when `initial` is not plain JSON, which the cache could not keep.
 */
export function processStateFrom(
  reaction: Pick<ReactionEntry, 'id' | 'events' | 'initial' | 'evolve'>,
  build: string,
): string | undefined {
  const { evolve, initial } = reaction;
  if (evolve === undefined || plainJsonProblem(initial, 0, true) !== undefined) return undefined;
  const text = String(evolve);
  if (text.includes('[native code]')) return undefined;
  return sha256(
    canonicalizeJson({
      build,
      events: [...(reaction.events ?? [])].sort(),
      evolve: text,
      initial,
      process: reaction.id,
    }),
  );
}
