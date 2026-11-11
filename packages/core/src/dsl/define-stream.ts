import type { AnyField } from '../fields/field-def.ts';
import type { Shape, ShapeFields } from '../fields/shape.ts';

/** A stream a module declares: records appended per key, outside the event log (section 15.1.12). */
export interface StreamDeclaration<K extends AnyField, Rf extends ShapeFields> {
  readonly kind: 'stream';
  readonly key: K;
  readonly record: Shape<Rf>;
  /** An entity name of the declaring module: who may `get` the keyed row may read the key (G6). */
  readonly readAs: string;
  /** Refused at compose until M4 (`streamOffloadUnavailable`, S-130). */
  readonly offload?: { readonly afterPerKey: number };
  readonly retention?: { readonly maxAge?: string; readonly maxPerKey?: number };
}

/** Any stream declaration, as the module base lists them. */
export type AnyStreamDeclaration = StreamDeclaration<AnyField, ShapeFields>;

/** A stream is listed by the base (`defineModuleBase({ streams })`), so it takes no base (S-162). */
export function defineStream<const K extends AnyField, const Rf extends ShapeFields>(
  spec: Omit<StreamDeclaration<K, Rf>, 'kind'>,
): StreamDeclaration<K, Rf> {
  return { kind: 'stream', ...spec };
}
