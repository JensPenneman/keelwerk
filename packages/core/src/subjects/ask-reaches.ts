import { trace } from '@opentelemetry/api';
import { effectiveRules } from '../authorization/effective-rules.ts';
import type { ErasureReach } from '../edge/erasure-reach.ts';
import { errors } from '../errors/errors.ts';
import { placeholderPrincipal } from '../invoker/edge/placeholder-principal.ts';
import { type ResolverEnv, withResolverKit } from '../invoker/edge/with-resolver-kit.ts';
import { erasureReachPoint } from './erasure-reach-point.ts';
import type { ReachErasureInput } from './reach-erasure-input.ts';

function isReach(value: unknown): value is ErasureReach {
  return typeof value === 'object' && value !== null && 'id' in value;
}

/** A filler of `core.erasureReach` with the module that contributed it. */
export interface Reach {
  readonly module: string;
  readonly reach: ErasureReach;
}

/** Runs `ask` in a read-only unit of the tenant over the fillers of `core.erasureReach`, with the authority of each one's module. */
export async function askReaches<T>(
  input: ReachErasureInput,
  ask: (
    reaches: readonly Reach[],
    drive: <R>(generator: unknown, module: string) => Promise<R>,
  ) => Promise<T>,
): Promise<T> {
  const { context, source, target, record } = input;
  const env: ResolverEnv = {
    options: {
      clock: context.clock,
      keys: context.keys,
      compute: context.compute,
      log: context.log,
    },
    rulesOf: effectiveRules,
  };
  const span = trace.getTracer('keelwerk').startSpan('keelwerk.erasure.reach');
  try {
    return await withResolverKit(
      {
        env,
        registry: source.registry,
        target,
        backendTarget: null,
        config: () => undefined,
        transport: 'erasure',
        requestId: record.commandId,
        span,
        // An archived row still holds its values: the step sees what the person still holds.
        includeArchived: true,
      },
      async (kit) => {
        const placeholder = placeholderPrincipal(target.scope);
        const reaches = kit.fills(erasureReachPoint, placeholder).map(({ module, value }) => {
          if (!isReach(value)) {
            throw errors.internal(
              `A fill of ${erasureReachPoint} by "${module}" is not an erasure reach.`,
            );
          }
          return { module, reach: value };
        });
        return ask(reaches, (generator, module) => kit.drive(generator, module, placeholder));
      },
    );
  } finally {
    span.end();
  }
}
