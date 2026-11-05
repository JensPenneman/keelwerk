import type { ControlStore } from './control-store.ts';
import { runGeneratedCreate } from './run-generated-create.ts';

/** The values of a new `core.backend` row (S-26). */
export interface BackendInput {
  readonly name: string;
  readonly app: string;
  /** A placement name of the deployment. */
  readonly placement: string;
  readonly apiVersion?: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** Creates a backend row through the generated `core.backend.create` (S-26); the name is unique. */
export async function createBackend(
  store: ControlStore,
  input: BackendInput,
): Promise<{ readonly id: string }> {
  return runGeneratedCreate(store, 'backend', {
    name: input.name,
    app: input.app,
    placement: input.placement,
    ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
    ...(input.config === undefined ? {} : { config: { ...input.config } }),
  });
}
