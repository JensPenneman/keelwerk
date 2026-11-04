/** What every field node carries (section 16.2.3). */
export interface FieldNodeBase {
  readonly optional: boolean;
  /** In wire form. */
  readonly default?: unknown;
  readonly description?: string;
  /** System fields 'read'; `field.secret()` 'write'. */
  readonly access: 'read-write' | 'read' | 'write';
  /** Rules may hide it per row. */
  readonly maskable?: true;
  readonly merge?:
    | 'lww'
    | 'max'
    | 'min'
    | 'counter'
    | 'set'
    | 'sequence'
    | 'richText'
    | 'exclusive';
  readonly unique?: true;
  readonly personal?: true;
  readonly tag?: number;
  readonly deprecated?: { readonly reason: string };
}
