import type { ExternalEffect } from './external-effect.ts';
import type { Request } from './request.ts';

/** `ctx.perform(effectDraft)`: prepare only; the effect's inline executor answers `{ ok: true, value } | { ok: false, error }`. */
export interface PerformRequest<T = unknown> extends Request<T> {
  readonly kind: 'perform';
  readonly effect: ExternalEffect;
}
