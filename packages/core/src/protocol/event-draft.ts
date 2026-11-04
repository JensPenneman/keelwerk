import type { Draft } from './draft.ts';

/** A domain event by name: `ctx.events.<name>(payload)` or `ctx.write.<m>.<e>.<event>(target, payload)`. */
export interface EventDraft extends Draft {
  readonly kind: 'event';
  readonly entity: string;
  readonly id: string;
  readonly expectedVersion?: number;
  readonly values: Readonly<Record<string, unknown>>;
}
