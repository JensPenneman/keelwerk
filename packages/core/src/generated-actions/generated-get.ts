import { allOf } from '../authorization/all-of.ts';
import { createRowMatcher } from '../authorization/create-row-matcher.ts';
import { errors } from '../errors/errors.ts';
import { createEntityRepository } from '../repositories/entity-repository.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { issueStateToken } from '../tokens/issue-state-token.ts';
import { argumentsOf } from './arguments-of.ts';
import { asOfInstant } from './as-of-instant.ts';
import type { GeneratedRead } from './generated-read-input.ts';
import { isRowId } from './is-row-id.ts';
import { projectRow } from './project-row.ts';
import { readFlag } from './read-flag.ts';
import { readSession } from './read-session.ts';
import { readStrings } from './read-strings.ts';
import { rowAsOfInstant } from './row-as-of-instant.ts';

/**
 * The generated `get` (section 6.7): rows by id under the caller's read plan, the ids that are not
 * there (or not the caller's to see) as `notFound`, and the `state` token of the head the unit read
 * first, so it is a valid `after` for `changes`. With `asOf` (an instant, chain entities only) the
 * rows are rebuilt as they were then, authorized and masked against the row as it was, with no token.
 */
export const generatedGet: GeneratedRead = async (input) => {
  const { entry, unit } = input;
  const args = argumentsOf(input.input);
  const ids = readStrings(args.ids, 'ids');
  if (ids === undefined)
    throw errors.validation('get needs ids.', {
      issues: [{ path: ['ids'], message: 'Required.' }],
    });
  if (ids.length > entry.page.maxSize) {
    throw errors.validation(`At most ${entry.page.maxSize} ids.`, {
      issues: [{ path: ['ids'], message: `At most ${entry.page.maxSize} ids.` }],
    });
  }
  const fields = readStrings(args.properties ?? args.fields, 'properties');
  const includeArchived = readFlag(args.includeArchived, 'includeArchived');
  const unique = [...new Set(ids)];
  const askable = unique.filter(isRowId);
  const session = readSession(input);
  let rows: readonly StorageRow[];
  if (args.asOf !== undefined && args.asOf !== null) {
    if (entry.descriptor.history !== 'chain') {
      throw errors.unsupported(
        `${entry.ref} is not a chain entity: it has no history to read as of an instant.`,
      );
    }
    const at = asOfInstant(args.asOf);
    const folded: StorageRow[] = [];
    for (const id of askable) {
      const row = await rowAsOfInstant({ unit, registry: input.registry, entry, id, at });
      if (
        row !== undefined &&
        (includeArchived || row.archivedAt === undefined || row.archivedAt === null)
      ) {
        folded.push(row);
      }
    }
    const { plan } = session.view;
    const matches = await createRowMatcher([plan.where], folded, {
      entity: entry.ref,
      answerer: session.answerer,
    });
    rows = folded.filter(
      (row) => plan.kind !== 'never' && (plan.kind === 'always' || matches(plan.where, row)),
    );
  } else if (askable.length === 0) {
    rows = [];
  } else {
    const found = await createEntityRepository(unit, entry).find({
      where: allOf([{ op: 'in', field: 'id', value: askable }, session.view.plan.where]),
      page: { first: askable.length },
      ...(includeArchived ? { includeArchived: true } : {}),
    });
    rows = found.rows;
  }
  const list = (await session.present(rows)).map((row) => projectRow(row, fields));
  const seen = new Set(rows.map((row) => String(row.id)));
  const notFound = unique.filter((id) => !seen.has(id));
  return {
    list,
    notFound,
    ...(args.asOf === undefined || args.asOf === null
      ? { state: issueStateToken(input.tokens, entry.ref, input.scope, input.head) }
      : {}),
  };
};
