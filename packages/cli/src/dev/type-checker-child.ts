import type { CliHost } from '../context/cli-host.ts';
import { lineBuffer } from './line-buffer.ts';
import type { TypeCheckerCommand } from './type-checker-command.ts';
import type { TypeCheckerStatus } from './type-checker-status.ts';
import { typeCheckerStatusOf } from './type-checker-status-of.ts';

/** The running type checker. */
export interface TypeChecker {
  stop(): Promise<void>;
}

/**
 * Starts the type checker as a child. Diagnostics stay visible (every line goes to `print`) and
 * never stop the app: type stripping does not need types, but `keelwerk build` refuses them.
 */
export function startTypeChecker(
  host: CliHost,
  root: string,
  command: TypeCheckerCommand,
  print: (line: string) => void,
  report: (status: TypeCheckerStatus) => void,
): TypeChecker {
  const lines = lineBuffer((line) => {
    const status = typeCheckerStatusOf(line);
    if (status !== undefined) report(status);
    if (line.trim() !== '') print(line);
  });
  report({ kind: 'checking' });
  const child = host.spawn(command.command, command.args, {
    cwd: root,
    onStdout: lines.push,
    onStderr: lines.push,
  });
  return {
    stop: async () => {
      child.kill('SIGTERM');
      await child.exited;
      lines.flush();
    },
  };
}
