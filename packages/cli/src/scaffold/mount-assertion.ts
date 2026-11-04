/** What a test beside a part asserts about the module value: a member of it and a dotted path inside. */
export interface MountAssertion {
  readonly member: 'actions' | 'entities' | 'policies' | 'reactions';
  readonly path: string;
}
