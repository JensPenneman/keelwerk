import type { EntityDescriptor, RowPage, SearchRequest } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { malformedQuery } from '../sql/malformed-query.ts';
import { memoryCandidates } from './memory-candidates.ts';
import { memoryPage } from './memory-page.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * Capability `search: 'naive'` (14.3.7): every word of the text must occur, ignoring case, in the
 * text of the index's fields. Keyed token indexes (personal fields) are served by the kernel's
 * token index, not by this adapter.
 */
export async function memorySearch(
  ctx: MemoryUnitContext,
  entity: EntityDescriptor,
  request: SearchRequest,
  maxOffset: number,
): Promise<RowPage> {
  const index = entity.searchIndexes.find((candidate) => candidate.name === request.index);
  if (index === undefined)
    throw malformedQuery(`${entity.ref} has no search index ${request.index}`);
  if (index.form !== 'native' || !('text' in request.match)) {
    throw errors.unsupported('the in-memory adapter searches plaintext indexes only');
  }
  const words = request.match.text
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== '');
  const candidates = memoryCandidates(ctx, entity, request.where, false).filter((row) => {
    const text = index.fields
      .map((field) => row[field])
      .filter((value): value is string => typeof value === 'string')
      .join('\n')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
  return memoryPage(entity, candidates, {
    ...(request.page === undefined ? {} : { page: request.page }),
    ...(request.where === undefined ? {} : { where: request.where }),
    maxOffset,
  });
}
