import type { AnyField } from '../fields/field-def.ts';
import type { Shape } from '../fields/shape.ts';

/** A stream a module declares (section 15.1.12): records appended per key. */
export interface StreamEntry {
  /** '<module>.<name>', 'deployments.log'. */
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  readonly key: AnyField;
  readonly record: Shape;
  /** '<module>.<entity>' resolved from the declaration's entity name. */
  readonly readAs: string;
  readonly offload?: { readonly afterPerKey: number };
  readonly retention?: { readonly maxAge?: string; readonly maxPerKey?: number };
}
