import { describe, expect, test } from 'vitest';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { TrackSnapshot } from '../storage/track-snapshot.ts';
import { recordedMemberTags } from './recorded-member-tags.ts';

const descriptor = { memberTags: { a: 1, b: 2 } } as unknown as FieldDescriptor;
const snapshot: TrackSnapshot = {
  track: 'library',
  version: 1,
  tables: [],
  entities: {
    'library.book': {
      history: 'chain',
      mergeState: false,
      fields: { meta: descriptor },
      renames: [],
      events: {},
      evolveHash: '',
    },
  },
};

describe('recordedMemberTags', () => {
  test('answers the tags a snapshot records for a field', () => {
    const recorded = recordedMemberTags([snapshot]);
    expect(recorded?.('library.book', 'meta')).toEqual({ a: 1, b: 2 });
    expect(recorded?.('library.book', 'other')).toBeUndefined();
    expect(recorded?.('library.shelf', 'meta')).toBeUndefined();
  });

  test('without snapshots there is nothing to look up', () => {
    expect(recordedMemberTags(undefined)).toBeUndefined();
    expect(recordedMemberTags([])).toBeUndefined();
  });
});
