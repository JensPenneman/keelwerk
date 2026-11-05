import { errors } from '../errors/errors.ts';
import { issueStateToken } from '../tokens/issue-state-token.ts';
import { argumentsOf } from './arguments-of.ts';
import { collectChangedStreams } from './collect-changed-streams.ts';
import { disclosureRule } from './disclosure-rule.ts';
import type { GeneratedRead } from './generated-read-input.ts';
import { readFilter } from './read-filter.ts';
import { readSession } from './read-session.ts';
import { readSinceToken } from './read-since-token.ts';
import { readSize } from './read-size.ts';
import { readSort } from './read-sort.ts';
import { readString } from './read-string.ts';

/** The scan that counts the rows before an added id when the adapter has no `countBefore`. */
const scanBound = 10_000;

/**
 * The generated `queryChanges` (section 6.7): since a `queryState`, the changed ids that were in
 * the old results (readable and matching at that position) as `removed`, and the changed ids that
 * are readable and match now as `added`, each with its index in the current order. The filter and
 * sort are bound into the token's check, so another filter or sort resets. More than
 * `maxChanges` changed streams is `tooManyChanges`.
 */
export const generatedQueryChanges: GeneratedRead = async (input) => {
  const { entry, unit } = input;
  const args = argumentsOf(input.input);
  const sinceQueryState = readString(args.sinceQueryState, 'sinceQueryState');
  if (sinceQueryState === undefined) {
    throw errors.validation('queryChanges needs a sinceQueryState.', {
      issues: [{ path: ['sinceQueryState'], message: 'Required.' }],
    });
  }
  const filter = readFilter(args.filter);
  const sort = readSort(args.sort, entry);
  const maxChanges =
    readSize(args.maxChanges, 'maxChanges', entry.page.maxSize) ?? entry.page.maxSize;
  const selector = { query: { filter, sort } };
  const fresh = (): string =>
    issueStateToken(input.tokens, entry.ref, input.scope, input.head, selector);
  const since = readSinceToken(input, sinceQueryState, selector);
  if (!since.ok) {
    return { cannotCalculateChanges: true, reason: since.reason, newQueryState: fresh() };
  }
  const session = readSession(input);
  const where = session.view.select(
    filter,
    sort.map((item) => item.field),
  );
  const changed = await collectChangedStreams({
    unit,
    entry,
    since: since.position,
    head: input.head,
    partition: undefined,
    maxStreams: maxChanges,
  });
  if (changed.hasMore) {
    return { cannotCalculateChanges: true, reason: 'tooManyChanges', newQueryState: fresh() };
  }
  const verdict = await disclosureRule({
    unit,
    registry: input.registry,
    entry,
    since: since.position,
    where,
    streams: changed.streams,
    earlier: 'all',
  });
  if (verdict.uncertain) {
    return { cannotCalculateChanges: true, reason: 'uncertain', newQueryState: fresh() };
  }
  const removed = [...changed.streams.keys()].filter((id) => verdict.before.has(id));
  const added: { id: string; index: number }[] = [];
  for (const id of changed.streams.keys()) {
    if (!verdict.now.has(id)) continue;
    const query = { where, sort };
    let index: number;
    if (unit.rows.countBefore !== undefined) {
      index = await unit.rows.countBefore(entry.descriptor, query, id);
    } else {
      index = 0;
      let found = false;
      let cursor: string | undefined;
      while (!found) {
        const page = await unit.rows.find(entry.descriptor, {
          ...query,
          page: { first: entry.page.maxSize, ...(cursor === undefined ? {} : { after: cursor }) },
        });
        const hit = page.rows.findIndex((row) => String(row.id) === id);
        if (hit >= 0) {
          index += hit;
          found = true;
        } else {
          index += page.rows.length;
          if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null || index > scanBound) {
            return {
              cannotCalculateChanges: true,
              reason: 'tooManyChanges',
              newQueryState: fresh(),
            };
          }
          cursor = page.pageInfo.endCursor;
        }
      }
    }
    added.push({ id, index });
  }
  added.sort((a, b) => a.index - b.index);
  return {
    oldQueryState: sinceQueryState,
    newQueryState: fresh(),
    removed,
    added,
  };
};
