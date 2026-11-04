import type { DecideContext } from '../contexts/decide-context.ts';
import type { BaseOf, PartSource, WhenOf } from '../model/part-source.ts';
import type { Service } from '../model/service.ts';

/** Declares a service bound to the providing module's context; callers delegate with `yield*` (section 5.5). */
export function defineService<const S extends PartSource, A extends readonly unknown[], R>(
  source: S,
  fn: (own: DecideContext<BaseOf<S>, WhenOf<S>>, ...args: A) => R,
): Service<S, A, R> {
  return { kind: 'service', source, fn };
}
