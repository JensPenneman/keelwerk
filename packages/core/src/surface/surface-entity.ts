import type { FieldNode } from './field-node.ts';
import type { PageSpec } from './page-spec.ts';
import type { SurfaceRelation } from './surface-relation.ts';

export interface SurfaceEntity {
  /** 'accounts.profile'. */
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  /** TypeID prefix; unique within the app. */
  readonly prefix: string;
  /** The last two are read-only through actions (section 6.6). */
  readonly history: 'chain' | 'state' | 'projection' | 'external';
  readonly tenancy: 'tenant' | 'backend' | 'deployment';
  /** System fields included; `tenantId` and hidden fields never. */
  readonly fields: Readonly<Record<string, FieldNode>>;
  readonly relations: Readonly<Record<string, SurfaceRelation>>;
  /** Switched on: get, query, changes, queryChanges, create, update, archive, restore, set, watch, history. */
  readonly generated: readonly string[];
  readonly page: PageSpec;
  /** Contributed field or relation name to the contributing module id. */
  readonly origin: Readonly<Record<string, string>>;
  readonly description?: string;
}
