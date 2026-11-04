import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { EntityBehaviour } from '../write-path/entity-behaviour.ts';
import type { GeneratedActionKind } from './generated-action-kind.ts';
import type { TrackRef } from './track-ref.ts';

/** One entity as the registry holds it: the walkable descriptor plus what the surface and the generator need. */
export interface EntityEntry {
  /** 'accounts.profile'. */
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  /** TypeID prefix, unique within the app. */
  readonly prefix: string;
  /** Fields, relations, indexes and physical names (S-59); hidden and maskable flags live on the fields. */
  readonly descriptor: EntityDescriptor;
  /** The active tracks, owner's first, then contributions in module order; must agree with `descriptor.shape.tracks` (WP-27 derives one from the other, with a test). */
  readonly tracks: readonly TrackRef[];
  /** Generated actions that are switched on. */
  readonly generated: readonly GeneratedActionKind[];
  /** Contributed field or relation name to the contributing module id. */
  readonly origin: Readonly<Record<string, string>>;
  readonly page: {
    readonly sortable: readonly string[];
    readonly defaultSort: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[];
    readonly defaultSize: number;
    readonly maxSize: number;
  };
  /** Field name to the track (section 14.6.1) of the source that declares it, conditional parts included (F-10 change note, WP-43). */
  readonly fieldTracks?: Readonly<Record<string, string>>;
  /** The author's `evolve`, invariant and the defaults of every active source, which the write path reads (F-10 change note, WP-43). */
  readonly behaviour?: EntityBehaviour;
  /** Domain events by name, with the schema of their data. */
  readonly events: Readonly<Record<string, StandardSchemaV1 | null>>;
  readonly description?: string;
}
