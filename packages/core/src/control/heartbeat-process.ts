import type { ControlStore } from './control-store.ts';
import { runControlCommand } from './run-control-command.ts';

/** Stamps the process's `core.process` row with the current time, leaving its state alone. */
export async function heartbeatProcess(store: ControlStore, processId: string): Promise<void> {
  await runControlCommand(store, 'process.heartbeat', (ctx) => [
    ctx.write.core.process.update(processId as never, { heartbeatAt: store.clock.now() }),
  ]);
}
