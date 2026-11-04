import type { FieldNode } from './field-node.ts';

export interface SurfaceEvent {
  readonly entity: string;
  /** 'created', 'changed', 'archived', 'restored', 'erased' or a domain event. */
  readonly name: string;
  readonly generated: boolean;
  /** Domain events only. */
  readonly data?: FieldNode;
}
