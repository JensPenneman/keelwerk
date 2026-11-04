import type { ControlStore } from './control-store.ts';
import { runControlCommand } from './run-control-command.ts';

/** The values of a new `core.backend` row (S-26). */
export interface BackendInput {
  readonly name: string;
  readonly app: string;
  /** A placement name of the deployment. */
  readonly placement: string;
  readonly apiVersion?: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/**
 * Creates a backend row through the write path, the programmatic form of the generated
 * `core.backend.create` until the generated actions are served (S-26); the name is unique.
 */
export async function createBackend(
  store: ControlStore,
  input: BackendInput,
): Promise<{ readonly id: string }> {
  let id = '';
  await runControlCommand(store, 'backend.create', (ctx) => {
    const draft = ctx.write.core.backend.create({
      name: input.name,
      app: input.app,
      placement: input.placement,
      ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
      ...(input.config === undefined ? {} : { config: { ...input.config } }),
    });
    id = draft.id;
    return [draft];
  });
  return { id };
}
