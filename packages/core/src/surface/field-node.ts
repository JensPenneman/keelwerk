import type { FieldNodeBase } from './field-node-base.ts';
import type { JsonSchema } from './json-schema.ts';

/** One field, input or output of the surface, by kind (the table of section 16.2.3). */
export type FieldNode = FieldNodeBase &
  (
    | {
        readonly kind: 'string' | 'text';
        readonly minLength?: number;
        readonly maxLength?: number;
        readonly pattern?: string;
        readonly format?: 'email' | 'uri' | 'hostname';
      }
    | {
        readonly kind: 'integer';
        readonly wide: boolean;
        readonly min?: number;
        readonly max?: number;
      }
    | { readonly kind: 'decimal'; readonly min?: string; readonly max?: string }
    | { readonly kind: 'serial'; readonly per: readonly string[] }
    | {
        readonly kind:
          | 'boolean'
          | 'float'
          | 'instant'
          | 'date'
          | 'timeZone'
          | 'subject'
          | 'richText'
          | 'binary'
          | 'blob'
          | 'secret'
          | 'void';
      }
    | { readonly kind: 'enum'; readonly values: readonly string[] }
    /** 'id' is the entity's own id. */
    | { readonly kind: 'id' | 'ref'; readonly target: string; readonly prefix: string }
    | { readonly kind: 'list' | 'set'; readonly item: FieldNode }
    | { readonly kind: 'shape'; readonly fields: Readonly<Record<string, FieldNode>> }
    | { readonly kind: 'json'; readonly schema: JsonSchema }
    | { readonly kind: 'page'; readonly item: FieldNode }
    | { readonly kind: 'foreign'; readonly input: JsonSchema; readonly output: JsonSchema }
  );
