import type { GlobalOptions } from './global-options.ts';
import type { ResolvedProfile } from './resolved-profile.ts';
import { usageFailure } from './usage-failure.ts';

/** The command groups that act on the deployment itself, never inside a tenant (section 16.9.7). */
function isDeploymentLevelGroup(command: string): boolean {
  switch (command) {
    case 'backend':
    case 'tenant':
    case 'operator':
      return true;
    default:
      return false;
  }
}

/**
 * The profile a command of a deployment-level group runs with: `--tenant` is refused (exit 2),
 * and the profile's own `tenant` is dropped, so no tenant marker reaches an action that works at
 * deployment scope. Any other command keeps its profile.
 */
export function deploymentLevelProfile(
  command: string | undefined,
  options: GlobalOptions,
  profile: ResolvedProfile,
): ResolvedProfile {
  if (command === undefined || !isDeploymentLevelGroup(command)) return profile;
  if (options.tenant !== undefined) {
    throw usageFailure(
      `--tenant does not apply to "${command}": it works on the deployment. Use "call <action> --tenant <id>" to act inside a tenant.`,
    );
  }
  const { tenant: _tenant, ...rest } = profile;
  return rest;
}
