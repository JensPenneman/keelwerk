import type { EntityEntry, TrackSnapshot } from '@keelwerk/core';
import { buildTrackSnapshot } from '../../../src/index.ts';
import { fieldDescriptor } from './field-descriptor.ts';
import { handBuiltEntry } from './hand-built-entry.ts';

const book = handBuiltEntry({
  module: 'library',
  name: 'book',
  prefix: 'bok',
  fields: {
    title: fieldDescriptor('title', 'string', { constraints: { maxLength: 200 }, tag: 1 }),
    isbn: fieldDescriptor('isbn', 'string', {
      constraints: { maxLength: 17 },
      unique: true,
      merge: 'exclusive',
      tag: 2,
    }),
    onLoan: fieldDescriptor('onLoan', 'boolean', { optional: true, tag: 1 }),
  },
  tracks: [
    { track: 'library', contributedBy: null },
    { track: 'loans->library', contributedBy: 'loans' },
  ],
  origin: { onLoan: 'loans' },
});

const loan = handBuiltEntry({
  module: 'loans',
  name: 'loan',
  prefix: 'lon',
  fields: {
    borrower: fieldDescriptor('borrower', 'subject', { indexed: true, tag: 1 }),
    dueOn: fieldDescriptor('dueOn', 'date', { tag: 2 }),
    bookId: fieldDescriptor('bookId', 'ref', {
      optional: true,
      ref: { entity: 'library.book', foreignKey: true },
      tag: 1,
    }),
  },
  tracks: [
    { track: 'loans', contributedBy: null },
    { track: 'loans[library]', contributedBy: null },
  ],
});

/** The registry does not record conditional fields (gap in 14.6.1): `loans[library]` adds `bookId`. */
function goldenTrackOfField(entry: EntityEntry, field: string): string {
  if (entry.ref === 'loans.loan' && field === 'bookId') return 'loans[library]';
  const own = entry.tracks[0]?.track ?? entry.module;
  const contributor = entry.origin[field];
  if (contributor === undefined) return own;
  return entry.tracks.find((track) => track.contributedBy === contributor)?.track ?? own;
}

/** Two hand-built entities: `library.book` with a field `loans` contributes, `loans.loan` with a part that needs `library`. */
export const goldenEntries: readonly EntityEntry[] = [book, loan];

/** The snapshots of the four tracks of the hand-built entities, the inputs of the stored-format goldens. */
export const goldenSnapshots: ReadonlyMap<string, TrackSnapshot> = buildTrackSnapshot(
  goldenEntries,
  { trackOfField: goldenTrackOfField },
);
