import { conditionFields } from '../conditions/condition-fields.ts';
import { errors } from '../errors/errors.ts';
import { argumentsOf } from '../generated-actions/arguments-of.ts';
import { invalidArgument } from '../generated-actions/invalid-argument.ts';
import { readFilter } from '../generated-actions/read-filter.ts';
import { readFlag } from '../generated-actions/read-flag.ts';
import { readString } from '../generated-actions/read-string.ts';
import { readStrings } from '../generated-actions/read-strings.ts';
import type { WatchInput } from '../live/watch-input.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { ParsedWatchInput } from './parsed-watch-input.ts';

/** The members of a watch input (15.4.2) as the live readers parse them; a member of the wrong type is `validation`, a filter through a relation `unsupported`. */
export function parseWatchInput(entry: EntityEntry, input: WatchInput<unknown>): ParsedWatchInput {
  const args = argumentsOf(input);
  const filter = readFilter(args.filter);
  if (filter !== undefined && conditionFields(filter).quantifiers.length > 0) {
    throw errors.unsupported('A live filter cannot follow a relation.', {
      issues: [{ path: ['filter'], message: 'A relation quantifier is not supported here.' }],
    });
  }
  const ids = readStrings(args.ids, 'ids');
  if (ids !== undefined && ids.length > entry.page.maxSize) {
    throw invalidArgument('ids', `It must name at most ${entry.page.maxSize} ids.`);
  }
  const { from } = args;
  if (from !== undefined && from !== null && from !== 'now' && from !== 'beginning') {
    throw invalidArgument('from', 'It must be "now" or "beginning".');
  }
  return {
    filter,
    ids: ids === undefined ? undefined : new Set(ids),
    fields: readStrings(args.fields, 'fields'),
    includeArchived: readFlag(args.includeArchived, 'includeArchived'),
    from: from === 'beginning' ? 'beginning' : 'now',
    after: readString(args.after, 'after'),
    partition: readString(args.partition, 'partition'),
  };
}
