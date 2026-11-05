import { errors } from '../errors/errors.ts';
import { createEntityRepository } from '../repositories/entity-repository.ts';
import { issueStateToken } from '../tokens/issue-state-token.ts';
import { argumentsOf } from './arguments-of.ts';
import type { GeneratedRead } from './generated-read-input.ts';
import { projectRow } from './project-row.ts';
import { readFilter } from './read-filter.ts';
import { readFlag } from './read-flag.ts';
import { readSession } from './read-session.ts';
import { readSize } from './read-size.ts';
import { readSort } from './read-sort.ts';
import { readString } from './read-string.ts';
import { readStrings } from './read-strings.ts';

/**
 * The generated `query` (section 6.7): the caller's filter conjoined with their read plan, a sort
 * from the entity's sortable fields, keyset pages (`first`/`after`, `last`/`before`; a size over
 * the maximum is `validation`), the opt-in `total`, and the `queryState` of the snapshot the page
 * was read from: the token of section 15.2.6 bound to this filter and sort.
 */
export const generatedQuery: GeneratedRead = async (input) => {
  const { entry, unit } = input;
  const args = argumentsOf(input.input);
  const filter = readFilter(args.filter);
  const sort = readSort(args.sort, entry);
  const first = readSize(args.first, 'first', entry.page.maxSize);
  const last = readSize(args.last, 'last', entry.page.maxSize);
  if (first !== undefined && last !== undefined) {
    throw errors.validation('first and last cannot be combined.', {
      issues: [{ path: ['last'], message: 'Use first with after, or last with before.' }],
    });
  }
  const after = readString(args.after, 'after');
  const before = readString(args.before, 'before');
  const fields = readStrings(args.properties, 'properties');
  const session = readSession(input);
  const found = await createEntityRepository(unit, entry).find({
    where: session.view.select(
      filter,
      sort.map((item) => item.field),
    ),
    sort,
    page:
      last === undefined
        ? { first: first ?? entry.page.defaultSize, ...(after === undefined ? {} : { after }) }
        : { last, ...(before === undefined ? {} : { before }) },
    ...(readFlag(args.total, 'total') ? { total: true } : {}),
    ...(readFlag(args.includeArchived, 'includeArchived') ? { includeArchived: true } : {}),
  });
  const items = (await session.present(found.rows)).map((row) => projectRow(row, fields));
  return {
    items,
    pageInfo: found.page.pageInfo,
    ...(found.page.total === undefined ? {} : { total: found.page.total }),
    queryState: issueStateToken(input.tokens, entry.ref, input.scope, found.position, {
      query: { filter, sort },
    }),
  };
};
