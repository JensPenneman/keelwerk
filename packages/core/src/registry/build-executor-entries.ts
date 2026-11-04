import type { JobGroup } from '../jobs/job-group.ts';
import type { JobRetry } from '../jobs/job-retry.ts';
import type { ExecutorEntry } from './executor-entry.ts';
import type { RuntimeModule } from './runtime-module.ts';

type Calculated<T> = (context: { readonly config: unknown; readonly input: unknown }) => T;

interface ExecutorOptionsView {
  readonly queue?: string;
  readonly capability?: readonly string[] | Calculated<readonly string[]>;
  readonly inline?: boolean;
  readonly timeout?: string;
  readonly group?: Calculated<JobGroup>;
  readonly retry?: JobRetry;
  readonly run: ExecutorEntry['run'];
}

/** The queue the jobs of an effect without an executor queue of its own use (section 9.5.1). */
const defaultQueue = 'effects';

/** The executors of the modules by the reference of their effect (section 7.9.5). */
export function buildExecutorEntries(
  ordered: readonly RuntimeModule[],
): ReadonlyMap<string, ExecutorEntry> {
  const executors = new Map<string, ExecutorEntry>();
  for (const module of ordered) {
    for (const [name, part] of Object.entries(module.executors)) {
      const options = Reflect.get(part, 'options') as ExecutorOptionsView;
      const ref = `${module.id}.${name}`;
      const capability = options.capability;
      executors.set(ref, {
        ref,
        module: module.id,
        effect: ref,
        queue: options.queue ?? defaultQueue,
        capability: typeof capability === 'function' ? [] : (capability ?? []),
        ...(typeof capability === 'function' ? { capabilityOf: capability } : {}),
        inline: options.inline ?? false,
        ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
        ...(options.group === undefined ? {} : { group: options.group }),
        ...(options.retry === undefined ? {} : { retry: options.retry }),
        run: options.run,
      });
    }
  }
  return executors;
}
