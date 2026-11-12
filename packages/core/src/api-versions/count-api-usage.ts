import type { AdmissionRun } from '../admission/run-admission.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import { deprecatedFrom } from './deprecated-from.ts';
import { utcDayOf } from './utc-day-of.ts';

/** Records the version total and, for an action whose deprecation has begun (`deprecated.at` <= today, or no `at`), its head ref; nothing for `run.dry`, a job carrier (`carrier.job`) or an invoker without `options.apiUsage`. Never throws. */
export function countApiUsage(env: InvokerEnv, run: AdmissionRun): Promise<void> {
  const usage = env.options.apiUsage;
  if (usage === undefined || run.dry === true || run.details.carrier.job !== undefined) {
    return Promise.resolve();
  }
  try {
    const { session, action } = run;
    const request = {
      scope: session.scope,
      apiVersion: session.apiVersion,
      transport: run.details.carrier.transport,
    };
    usage.record({ ...request, item: '' });
    const deprecated = action.deprecated;
    if (
      deprecated !== undefined &&
      deprecatedFrom(deprecated.at, utcDayOf(env.options.clock.now()))
    ) {
      usage.record({ ...request, item: action.ref });
    }
  } catch (error) {
    env.options.log.warn('an API request could not be counted', { cause: error });
  }
  return Promise.resolve();
}
