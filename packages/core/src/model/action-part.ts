/** Action kinds (section 7.1). */
export type ActionKind = 'command' | 'query' | 'subscription';

/** How external callers are answered (section 7.4). */
export type Execution = 'sync' | 'async' | 'either';

/** The phantom types of an action as callers see it: input, output, errors and the event of subscriptions. */
export interface PartTypes<I = unknown, O = unknown, Er = unknown, Ev = unknown> {
  readonly input: I;
  readonly output: O;
  readonly errors: Er;
  readonly event: Ev;
}

/**
 * An action part. `source` is the base (or `within` narrowing, or app selection) it was typed
 * against and `mount` the entity it is mounted on, so the module literal accepts it only there.
 * `ref` is the reference (`auth.credential.revoke`) that `defineModule` records when it mounts the part.
 */
export interface ActionPart<
  K extends ActionKind,
  S,
  Mount extends string | null,
  X extends Execution,
  T extends PartTypes,
> {
  readonly kind: K;
  readonly source: S;
  readonly mount: Mount;
  readonly execution: X;
  readonly spec: object;
  readonly ref?: string;
  readonly '~types'?: T;
}

/** Any action part. */
export type AnyActionPart = ActionPart<ActionKind, unknown, string | null, Execution, PartTypes>;

/** The output marker of entity commands without `output`: the row after the events, resolved per app. */
export interface RowOutput<Ref extends string> {
  readonly '~row': Ref;
}

/** The output marker of `pageOf(entity)`: a page of rows, resolved per app. */
export interface PageOutput<Ref extends string> {
  readonly '~page': Ref;
}
