import type { EntityEntry } from '@keelwerk/core';
import { conformanceEntries } from './conformance-entries.ts';

/** The conformance app's `library.book` entry. */
export const libraryBook: EntityEntry = (() => {
  const found = conformanceEntries.find((entry) => entry.ref === 'library.book');
  if (found === undefined) throw new Error('the conformance app has no library.book');
  return found;
})();
