/** A relation as the planner walks it (section 14.3.2). */
export interface RelationDescriptor {
  readonly kind: 'one' | 'many';
  /** 'auth.credential'. */
  readonly target: string;
  /** The field that holds the key. */
  readonly by: string;
  /** The field it matches, usually 'id'. */
  readonly to: string;
  /** The contributing module (section 5.3). */
  readonly contributedBy: string | null;
}
