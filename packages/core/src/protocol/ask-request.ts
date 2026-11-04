import type { Request } from './request.ts';

/** `ctx.ask(ref, input)`: a dependency's query action inside the unit, gated as the current principal. */
export interface AskRequest<T = unknown> extends Request<T> {
  readonly kind: 'ask';
  readonly ref: string;
  readonly input: unknown;
}
