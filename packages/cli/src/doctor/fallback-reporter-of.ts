import type { FallbackReporter } from '@keelwerk/core';

/** The `FallbackReporter` entry of the deployment's infrastructure, when it lists one. */
export function fallbackReporterOf(
  infrastructure: readonly unknown[],
): FallbackReporter | undefined {
  return infrastructure.find(
    (entry): entry is FallbackReporter =>
      typeof entry === 'object' &&
      entry !== null &&
      'kind' in entry &&
      entry.kind === 'fallbackReporter',
  );
}
