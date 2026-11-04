import type {
  ColumnSpec,
  EntityEntry,
  FieldDescriptor,
  ForeignKeySpec,
  IndexSpec,
  TableSpec,
  TrackSnapshot,
} from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { sha256 } from '@keelwerk/core/crypto';
import { entityForeignKeys } from './entity-foreign-keys.ts';
import { entityIndexes } from './entity-indexes.ts';
import { fieldColumns } from './field-columns.ts';
import { scopeColumnName } from './scope-column-name.ts';
import { systemColumns } from './system-columns.ts';

type EntityOfSnapshot = TrackSnapshot['entities'][string];

function defaultTrackOfField(entry: EntityEntry, field: string): string {
  if (entry.tracks.some((track) => track.track.includes('['))) {
    throw errors.unsupported(
      `${entry.ref} has a conditional part, whose fields the registry does not record: pass trackOfField`,
    );
  }
  const own = entry.tracks[0]?.track ?? entry.module;
  const contributor = entry.origin[field];
  if (contributor === undefined) return own;
  return entry.tracks.find((track) => track.contributedBy === contributor)?.track ?? own;
}

function sortedByName<T extends { readonly name: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function eventsOf(entry: EntityEntry): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.keys(entry.events).map((event) => [event, 1]));
}

interface Piece {
  readonly columns: ColumnSpec[];
  readonly indexes: IndexSpec[];
  readonly foreignKeys: ForeignKeySpec[];
  readonly fields: Record<string, FieldDescriptor>;
}

/** What `buildTrackSnapshot` needs besides the registry's entities. */
export interface SnapshotOptions {
  /** The number of each track's last migration file; a track not listed is at 0. */
  readonly versions?: Readonly<Record<string, number>>;
  /** The snapshots of the last run: their rename history carries over. */
  readonly previous?: ReadonlyMap<string, TrackSnapshot>;
  /**
   * The track a field belongs to. The default reads the registry: a contributed field belongs to
   * its contributor's track, everything else to the owner's own track. A conditional part's fields
   * need this callback, because the entry does not record them (gap in section 14.6.1).
   */
  readonly trackOfField?: (entry: EntityEntry, field: string) => string;
  /** SHA-256 of an entity's evolve source (section 15.2.4); default: the hash of the empty text. */
  readonly evolveHash?: (entityRef: string) => string;
  /** The versions of an entity's domain event shapes; default: 1 for each. */
  readonly eventVersions?: (entityRef: string) => Readonly<Record<string, number>>;
}

/** The neutral snapshots of every track of the given entities, by track id in sorted order (section 14.6.1). */
export function buildTrackSnapshot(
  entries: readonly EntityEntry[],
  options: SnapshotOptions = {},
): ReadonlyMap<string, TrackSnapshot> {
  const trackOf = options.trackOfField ?? defaultTrackOfField;
  const tables = new Map<string, Map<string, TableSpec>>();
  const entities = new Map<string, Record<string, EntityOfSnapshot>>();
  for (const entry of entries) {
    const descriptor = entry.descriptor;
    const tenancy = descriptor.tenancy;
    if (tenancy === 'invocation' || descriptor.history === 'external') continue;
    const ownTrack = entry.tracks[0]?.track ?? entry.module;
    const scopeColumn = scopeColumnName(tenancy);
    const pieces = new Map<string, Piece>();
    const pieceOf = (track: string): Piece => {
      let piece = pieces.get(track);
      if (piece === undefined) {
        piece = { columns: [], indexes: [], foreignKeys: [], fields: {} };
        pieces.set(track, piece);
      }
      return piece;
    };
    pieceOf(ownTrack);
    const trackIndex = (track: string): number =>
      Math.max(
        0,
        entry.tracks.findIndex((candidate) => candidate.track === track),
      );
    const latest = (fields: readonly string[]): string =>
      fields
        .map((field) => trackOf(entry, field))
        .reduce((a, b) => (trackIndex(b) > trackIndex(a) ? b : a), ownTrack);
    for (const [name, field] of Object.entries(descriptor.fields)) {
      const track = trackOf(entry, name);
      const piece = pieceOf(track);
      piece.fields[name] = field;
      const derived = Object.values(descriptor.derivedIndexes).filter(
        (index) => index.field === name,
      );
      const ordered = derived.find((index) => index.kind === 'ore');
      if (ordered !== undefined) {
        throw errors.unsupported(
          `${descriptor.ref}.${name}: order tokens need the ore type, which arrives with M5`,
        );
      }
      piece.columns.push(...fieldColumns(name, field, derived, track !== ownTrack));
    }
    for (const search of descriptor.searchIndexes) {
      if (search.form !== 'tokens') continue;
      const piece = pieceOf(latest(search.fields));
      const column = `kw_search_${search.name}`;
      const empty = { field: null, nullable: true, default: null, constraints: {} } as const;
      piece.columns.push(
        { ...empty, name: column, kind: 'tags' },
        { ...empty, name: `${column}_counts`, kind: 'sealed' },
      );
    }
    for (const index of entityIndexes(descriptor, scopeColumn)) {
      pieceOf(latest(index.fields)).indexes.push(index.spec);
    }
    for (const key of entityForeignKeys(descriptor, scopeColumn)) {
      pieceOf(trackOf(entry, key.field)).foreignKeys.push(key.spec);
    }
    for (const [track, piece] of pieces) {
      const owns = track === ownTrack;
      const table: TableSpec = {
        name: descriptor.table,
        columns: owns ? [...systemColumns(scopeColumn), ...piece.columns] : piece.columns,
        primaryKey: owns ? [...(scopeColumn === null ? [] : [scopeColumn]), 'id'] : [],
        indexes: piece.indexes,
        foreignKeys: piece.foreignKeys,
        scoped: tenancy,
      };
      if (!owns && table.columns.length === 0 && piece.indexes.length === 0) continue;
      const trackTables = tables.get(track) ?? new Map<string, TableSpec>();
      trackTables.set(table.name, table);
      tables.set(track, trackTables);
      const trackEntities = entities.get(track) ?? {};
      trackEntities[descriptor.ref] = {
        history: descriptor.history,
        mergeState: descriptor.mergeState,
        fields: piece.fields,
        renames: options.previous?.get(track)?.entities[descriptor.ref]?.renames ?? [],
        events: options.eventVersions?.(descriptor.ref) ?? eventsOf(entry),
        evolveHash: options.evolveHash?.(descriptor.ref) ?? sha256(''),
      };
      entities.set(track, trackEntities);
    }
  }
  const snapshots = new Map<string, TrackSnapshot>();
  for (const track of [...tables.keys()].sort()) {
    snapshots.set(track, {
      track,
      version: options.versions?.[track] ?? 0,
      tables: sortedByName([...(tables.get(track)?.values() ?? [])]),
      entities: entities.get(track) ?? {},
    });
  }
  return snapshots;
}
