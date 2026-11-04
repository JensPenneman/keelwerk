/** One stream per entity instance: `{ type: 'accounts.profile', id: '0192...' }`. */
export interface StreamRef {
  readonly type: string;
  readonly id: string;
}
