import type { ControlStore } from './control-store.ts';
import { runControlCommand } from './run-control-command.ts';

/** What a process records about itself in `core.process` (S-22). */
export interface ProcessRegistration {
  readonly name?: string;
  readonly node: string;
  readonly roles: readonly ('serve' | 'work')[];
}

/** Registers the process in `core.process` as `starting`, with the build and revision it writes events with; answers the row id. */
export async function registerProcess(
  store: ControlStore,
  process: ProcessRegistration,
): Promise<string> {
  let id = '';
  await runControlCommand(store, 'process.register', (ctx) => {
    const draft = ctx.write.core.process.create({
      node: process.node,
      roles: [...process.roles],
      buildId: store.writer.build.id,
      revision: store.writer.build.revision,
      state: 'starting',
      heartbeatAt: store.clock.now(),
      ...(process.name === undefined ? {} : { name: process.name }),
    });
    id = draft.id;
    return [draft];
  });
  return id;
}
