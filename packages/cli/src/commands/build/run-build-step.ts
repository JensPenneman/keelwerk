import type { CliHost } from '../../context/cli-host.ts';
import type { BuildStep } from './build-step.ts';

/** Runs one step to its end in `root`, handing its output on as it arrives; true when it exited 0. */
export async function runBuildStep(
  host: CliHost,
  root: string,
  step: Pick<BuildStep, 'command' | 'args'>,
  out: { readonly stdout: (text: string) => void; readonly stderr: (text: string) => void },
): Promise<boolean> {
  const child = host.spawn(step.command, step.args, {
    cwd: root,
    env: host.env,
    onStdout: out.stdout,
    onStderr: out.stderr,
  });
  const exit = await child.exited;
  return exit.code === 0;
}
