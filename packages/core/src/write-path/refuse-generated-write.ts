import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { refusedApiVersionPin } from './refused-api-version-pin.ts';
import { refusedConfigChange } from './refused-config-change.ts';
import { refusedControlCreate } from './refused-control-create.ts';
import { refusedPlacementChange } from './refused-placement-change.ts';
import type { RunCommandInput } from './run-command-input.ts';

/**
 * Refuses the generated writes of `core.tenant` and `core.backend` that only the control path may
 * make: a create by anyone but the runtime, a change of backend, app or placement (14.4.5), a pin
 * of the API version, a change of a backend's configuration. Every way into a unit (a request, a nested `invoke`, a replay) runs it.
 */
export function refuseGeneratedWrite(run: RunCommandInput): void {
  const { action } = run;
  const created = refusedControlCreate(
    action.module,
    action.entity,
    action.generated,
    run.principal,
  );
  if (created !== undefined) {
    throw errors.forbidden(
      `"${action.ref}" does not create a row of the control plane; use Runtime.${created}, which checks the catalogue, the placement and the API version and runs the hooks.`,
    );
  }
  const moved = refusedPlacementChange(action.module, action.entity, action.generated, run.input);
  if (moved !== undefined) {
    throw new KeelwerkError({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: `"${action.ref}" would move data between placements; ${moved} changes backend, app or placement through core.tenant.move (section 14.4.5), which this release does not run.`,
    });
  }
  const configured = refusedConfigChange(action.module, action.entity, action.generated, run.input);
  if (configured !== undefined) {
    throw errors.validation(
      `"${action.ref}" does not change the configuration of a backend; it is checked and sealed when the backend is created, and changing it later is not supported in M1.`,
    );
  }
  const pinned = refusedApiVersionPin(action.module, action.entity, action.generated, run.input);
  if (pinned !== undefined) {
    throw errors.validation(
      `"${action.ref}" does not change an API version pin; ${pinned} pins change only through setApiVersion.`,
    );
  }
}
