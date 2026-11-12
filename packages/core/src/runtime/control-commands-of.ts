import type { CommandRunner } from '../invoker/command-runner.ts';
import type { Clock } from '../kernel/clock.ts';
import { createCommandRunner } from '../write-path/create-command-runner.ts';
import { answerRetireCommand } from './answer-retire-command.ts';
import type { Connected } from './connected.ts';
import type { ControlPath } from './control-path.ts';
import { routeControlCommands } from './route-control-commands.ts';
import type { ServedApp } from './served-app.ts';

/**
 * The command runner of the invoker: the write path, with the control commands routed to the
 * control path (S-109) and `core.retireApiVersion` answered by the runtime (18.5).
 */
export function controlCommandsOf(input: {
  readonly connected: Connected;
  readonly controlPath: ControlPath;
  readonly served: readonly ServedApp[];
  readonly clock: Clock;
}): CommandRunner {
  const { connected, controlPath, served, clock } = input;
  return answerRetireCommand(
    routeControlCommands(
      createCommandRunner({
        deploymentId: connected.control.deploymentId,
        nodeId: connected.nodeId,
        hybridClock: connected.hybridClock,
      }),
      controlPath,
    ),
    connected.control,
    new Map(served.map((app) => [app.id, app])),
    clock,
  );
}
