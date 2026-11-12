import { refOf } from '../dsl/ref-of.ts';
import { sealedWhereMember } from '../effects/sealed-where-member.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { probeContext } from './probe-context.ts';
import type { Registry } from './registry.ts';

/** One `ctx.live.effects` call a probe saw. */
interface RecordedCall {
  readonly ref: string;
  readonly where: unknown;
}

/** A context whose `live.effects` records its calls and whose other members are inert. */
function recordingContext(calls: RecordedCall[]): unknown {
  const stub = { kind: 'liveSource' };
  const recorder = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'effects'
          ? (effect: object, options?: { readonly where?: unknown }) => {
              try {
                calls.push({ ref: refOf(effect), where: options?.where });
              } catch {
                // An effect no module mounts has no reference to judge.
              }
              return stub;
            }
          : () => stub,
    },
  );
  return new Proxy({}, { get: (_target, key) => (key === 'live' ? recorder : probeContext()) });
}

/**
 * `pendingEffectsSealedFilter` (error, S-166): runs each custom subscription source once with
 * `probeContext()` as input and a context whose `live.effects` records its calls; a recorded `where`
 * whose `sealedWhereMember` is defined is a problem. Throws of the source are swallowed; a `where`
 * the probe does not reach is refused at setup (`ctx.live.effects` is `internal` for it).
 */
export function checkPendingEffectsWhere(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const action of registry.actions.values()) {
    if (action.kind !== 'subscription' || action.generated !== undefined) continue;
    const calls: RecordedCall[] = [];
    try {
      action.handler(probeContext(), recordingContext(calls), undefined);
    } catch {
      // A source that cannot run on a probe is outside what this check can see.
    }
    for (const call of calls) {
      const entry = registry.effects.get(call.ref);
      if (entry === undefined) continue;
      const member = sealedWhereMember(entry, call.where);
      if (member === undefined) continue;
      problems.push(
        compositionError(
          'pendingEffectsSealedFilter',
          `"${action.ref}" filters the pending effects of "${entry.ref}" by "${member}", which is no plaintext member of its input.`,
          { module: action.module, ref: action.ref },
        ),
      );
    }
  }
  return problems;
}
