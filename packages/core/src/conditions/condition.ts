/**
 * The condition AST of section 8.3, shared by the data layer, the live feed and the sync protocol.
 * Paths are dotted field and relation names; the typed `FieldPath` and `RelationPath` belong to
 * the DSL, which checks them before the AST exists.
 */
export type Condition =
  | {
      readonly op:
        | 'eq'
        | 'ne'
        | 'lt'
        | 'lte'
        | 'gt'
        | 'gte'
        | 'in'
        | 'nin'
        | 'contains'
        | 'startsWith';
      readonly field: string;
      readonly value: unknown;
    }
  | { readonly op: 'isNull'; readonly field: string; readonly value: boolean }
  | { readonly op: 'and' | 'or'; readonly conditions: readonly Condition[] }
  | { readonly op: 'not'; readonly condition: Condition }
  | {
      readonly op: 'some' | 'none' | 'every' | 'is';
      readonly relation: string;
      readonly where: Condition;
    }
  /** What an interpolated null or undefined comparison normalises to: it matches nothing. */
  | { readonly op: 'never' };
