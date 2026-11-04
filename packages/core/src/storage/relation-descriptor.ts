/** A relation as the planner walks it (section 14.3.2). */
export interface RelationDescriptor {
  readonly kind: 'one' | 'many';
  /** 'auth.credential'. */
  readonly target: string;
  /** The field that holds the key. */
  readonly by: string;
  /** The field it matches, usually 'id'. */
  readonly to: string;
  /** Set for a many-to-many relation: the join entity, the join field that matches `to`, and the join field that reaches the target. */
  readonly through?: {
    readonly module: string;
    readonly entity: string;
    readonly by: string;
    readonly to: string;
    readonly via: string;
  };
  /** The contributing module (section 5.3). */
  readonly contributedBy: string | null;
}
