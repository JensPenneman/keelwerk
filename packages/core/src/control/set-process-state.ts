import type { ControlStore } from './control-store.ts';
import { runControlCommand } from './run-control-command.ts';

/** Moves the process's `core.process` row to a state and stamps its heartbeat. */
export async function setProcessState(
  store: ControlStore,
  processId: string,
  state: 'starting' | 'ready' | 'draining' | 'stopped',
): Promise<void> {
  await runControlCommand(store, 'process.state', (ctx) => [
    ctx.write.core.process.update(processId as never, { state, heartbeatAt: store.clock.now() }),
  ]);
}
