import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';

/** `streamOffloadUnavailable` (S-130): offloading a stream's cold records waits for M4. */
export function checkStreamOffload(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  return [...registry.streams.values()]
    .filter((stream) => stream.offload !== undefined)
    .map((stream) =>
      compositionError(
        'streamOffloadUnavailable',
        `The stream '${stream.ref}' declares offload, which this release does not build.`,
        { module: stream.module, ref: stream.ref },
      ),
    );
}
