import type { ControlStore } from './control-store.ts';
import { runControlCommand } from './run-control-command.ts';

/**
 * Appends `core.tenant.hookFailed` or `core.tenant.hookCompleted` (data `{ hook }`) to the tenant's
 * stream in the control store, where `keelwerk doctor` reads them (S-84). A failure to record is
 * logged and never hides the hook's own outcome.
 */
export async function recordHookEvent(
  store: ControlStore,
  tenantId: string,
  type: 'hookFailed' | 'hookCompleted',
  hook: string,
): Promise<void> {
  try {
    await runControlCommand(store, `tenant.${type}`, (ctx) => ({
      events: [ctx.write.core.tenant[type](tenantId as never, { hook })],
    }));
  } catch (error) {
    store.log.error(`the outcome of the lifecycle hook ${hook} could not be recorded`, {
      hook,
      cause: error,
    });
  }
}
