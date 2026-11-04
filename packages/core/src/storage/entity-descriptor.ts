import type { DerivedIndexField } from './derived-index-field.ts';
import type { ExternalMapping } from './external-mapping.ts';
import type { FieldDescriptor } from './field-descriptor.ts';
import type { IndexDescriptor } from './index-descriptor.ts';
import type { RelationDescriptor } from './relation-descriptor.ts';
import type { SearchIndexDescriptor } from './search-index-descriptor.ts';
import type { ShapeRef } from './shape-ref.ts';

/** The walkable entity model as an adapter sees it; built by the registry, physical names derived (S-59). */
export interface EntityDescriptor {
  /** 'accounts.profile'. */
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  readonly history: 'chain' | 'state' | 'projection' | 'external';
  /** 'invocation': core receipts only. */
  readonly tenancy: 'tenant' | 'backend' | 'deployment' | 'invocation';
  /** The active tracks and their versions; events record its id (section 15.1.9). */
  readonly shape: ShapeRef;
  /** 'id', a field, or a path through an immutable reference ('accountId.ownerSubject'). */
  readonly dataSubject: string | null;
  /** Physical name inside the namespace root. */
  readonly table: string;
  readonly fields: Readonly<Record<string, FieldDescriptor>>;
  readonly relations: Readonly<Record<string, RelationDescriptor>>;
  /** Including partial unique indexes. */
  readonly indexes: readonly IndexDescriptor[];
  /** Field whose value partitions change tokens (section 15.1.4). */
  readonly partition: string | null;
  /** An offline-capable command can write this entity (M6). */
  readonly mergeState: boolean;
  /** Capability `search` or the kernel's token index (section 14.3.3). */
  readonly searchIndexes: readonly SearchIndexDescriptor[];
  /** Index fields of personal fields, kinds 'binary', 'tagSet' and 'ore'. */
  readonly derivedIndexes: Readonly<Record<string, DerivedIndexField>>;
  /** `history: 'external'` only (M5). */
  readonly external: ExternalMapping | null;
}
