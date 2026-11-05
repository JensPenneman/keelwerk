import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';

/**
 * The deployment file a data command runs against: project mode only. A profile or the operator
 * socket has no action that applies migrations or reads chains in this release, so they are refused
 * with the reason instead of being ignored.
 */
export function deploymentPathOf(context: CliContext, command: string): string {
  const { profile } = context;
  if (profile.kind === 'project' && profile.configPath !== undefined) return profile.configPath;
  if (profile.kind === 'none') {
    throw usageFailure(
      `db ${command} runs against the project's deployment file, and none was found: pass --config, set KEELWERK_CONFIG, or run it in the project.`,
    );
  }
  throw usageFailure(
    `db ${command} runs against the project's deployment file; a profile or the operator socket is not served for it in this release. Run it in the project, or pass --config.`,
  );
}
