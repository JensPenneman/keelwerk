import type { EntityDescriptor, EntityEntry, FieldDescriptor, TrackRef } from '@keelwerk/core';
import { physicalTableName } from '@keelwerk/core';

/** What a hand-built registry entry needs besides its fields. */
export interface HandBuiltEntryInput {
  readonly module: string;
  readonly name: string;
  readonly prefix: string;
  readonly fields: Readonly<Record<string, FieldDescriptor>>;
  readonly tracks: readonly Pick<TrackRef, 'track' | 'contributedBy'>[];
  /** The contributing module of each contributed field. */
  readonly origin?: Readonly<Record<string, string>>;
  readonly tenancy?: EntityDescriptor['tenancy'];
}

/** A registry entry written out by hand, so stored-format goldens do not move when other packages add entities. */
export function handBuiltEntry(input: HandBuiltEntryInput): EntityEntry {
  const ref = `${input.module}.${input.name}`;
  return {
    ref,
    module: input.module,
    name: input.name,
    prefix: input.prefix,
    descriptor: {
      ref,
      module: input.module,
      name: input.name,
      history: 'chain',
      tenancy: input.tenancy ?? 'tenant',
      shape: {
        id: `${ref}/shape`,
        tracks: Object.fromEntries(input.tracks.map((track) => [track.track, 0])),
      },
      dataSubject: null,
      table: physicalTableName(input.module, input.name),
      fields: input.fields,
      relations: {},
      indexes: [],
      partition: null,
      mergeState: false,
      searchIndexes: [],
      derivedIndexes: {},
      external: null,
    },
    tracks: input.tracks.map((track) => ({
      entity: ref,
      track: track.track,
      version: 0,
      contributedBy: track.contributedBy,
    })),
    generated: [],
    origin: input.origin ?? {},
    page: { sortable: [], defaultSort: [], defaultSize: 20, maxSize: 100 },
    events: {},
  };
}
