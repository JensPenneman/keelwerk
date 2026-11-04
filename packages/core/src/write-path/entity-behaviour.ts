/** What the kernel needs of an entity beyond its descriptor to write it (section 7.9.4, phase 6). */
export interface EntityBehaviour {
  /** Default values by field name, contributed fields included. */
  readonly defaults: Readonly<Record<string, unknown>>;
  /** The author's `evolve` by domain event name: pure, `(state, payload) => state`. */
  readonly evolve: Readonly<Record<string, (state: never, event: never) => unknown>>;
  /** The entity invariant, checked on every post-image. */
  readonly invariant: ((row: never) => boolean) | null;
}
