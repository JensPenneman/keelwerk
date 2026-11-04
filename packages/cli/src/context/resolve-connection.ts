import type { CliHost } from './cli-host.ts';
import { createHttpLink } from './create-http-link.ts';
import type { DeploymentLink } from './deployment-link.ts';
import { localFailure } from './local-failure.ts';
import { profileUrlProblem } from './profile-url-problem.ts';
import type { ResolvedProfile } from './resolved-profile.ts';
import { usageFailure } from './usage-failure.ts';

/**
 * The link for a resolved profile (section 16.9.1). A remote profile needs a URL that passes the
 * scheme rule of S-42; project mode and the in-process runtime belong to the commands that run
 * the project's definitions.
 */
export function resolveConnection(host: CliHost, profile: ResolvedProfile): DeploymentLink {
  switch (profile.kind) {
    case 'none':
      throw usageFailure(
        'No connection. Use --profile <name>, --socket <path>, or run inside a project.',
      );
    case 'project':
      throw localFailure(
        'unavailable',
        'cli.project_unavailable',
        'Action commands in a project need a running `keelwerk dev` or a profile; use --socket or --profile.',
      );
    case 'socket':
    case 'remote': {
      // A socket given by --socket has no profile URL to check; its path is the argument itself.
      const fromFlag = profile.kind === 'socket' && profile.name === undefined;
      const problem = fromFlag
        ? undefined
        : profile.url === undefined
          ? 'The profile has no URL.'
          : profileUrlProblem(profile.url);
      if (problem !== undefined) {
        throw usageFailure(problem);
      }
      return createHttpLink(host, profile);
    }
  }
}
