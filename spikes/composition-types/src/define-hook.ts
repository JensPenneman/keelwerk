import type { DecideContext } from './decide-context.ts';
import type { Decision } from './decision.ts';
import type { Id } from './id.ts';
import type { BaseOf, PartSource, WhenOf } from './part-source.ts';
import type { Gen } from './request.ts';

/** The payloads of the lifecycle hooks of section 3.3. */
export interface HookPayloads {
  readonly onTenantCreated: { readonly id: Id<'core.tenant'>; readonly name: string };
  readonly onTenantArchived: { readonly id: Id<'core.tenant'> };
  readonly onBackendCreated: { readonly id: Id<'core.backend'>; readonly name: string };
}

/** A lifecycle hook part. */
export interface HookPart<S, H extends keyof HookPayloads> {
  readonly kind: 'hook';
  readonly source: S;
  readonly hook: H;
  readonly fn: object;
}

/** A lifecycle hook is a reaction: pure, returning a decision. */
export function defineHook<const S extends PartSource, const H extends keyof HookPayloads>(
  source: S,
  hook: H,
  fn: (
    payload: HookPayloads[H],
    ctx: DecideContext<BaseOf<S>, WhenOf<S>>,
  ) => Decision | Gen<Decision>,
): HookPart<S, H> {
  return { kind: 'hook', source, hook, fn };
}
