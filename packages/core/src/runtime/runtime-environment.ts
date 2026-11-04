import type { RowEnvironment } from '../authorization/row-environment.ts';
import type { RuntimeOptions } from './runtime-options.ts';

/**
 * Where the runtime runs: the option, else development or test when `NODE_ENV` says so and
 * production otherwise, so a caller who names nothing never auto-applies schema differences or
 * shows internal errors.
 */
export function runtimeEnvironment(options: RuntimeOptions): RowEnvironment {
  if (options.environment !== undefined) return options.environment;
  const named = options.env?.NODE_ENV;
  return named === 'development' || named === 'test' ? named : 'production';
}
