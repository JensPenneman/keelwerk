import type { OpenedConnection } from '../connections/opened-connection.ts';
import { projectConnection } from '../connections/project-connection.ts';
import { remoteConnection } from '../connections/remote-connection.ts';
import { socketConnection } from '../connections/socket-connection.ts';
import type { CliHost } from './cli-host.ts';
import { profileUrlProblem } from './profile-url-problem.ts';
import type { ResolvedProfile } from './resolved-profile.ts';
import { usageFailure } from './usage-failure.ts';

/**
 * Opens the connection a resolved profile names (section 16.9.1): the project's dev socket or
 * in-process runtime, the operator socket, or a remote deployment. A profile URL passes the scheme
 * rule of S-42 before anything is sent.
 */
export async function resolveConnection(
  host: CliHost,
  profile: ResolvedProfile,
): Promise<OpenedConnection> {
  switch (profile.kind) {
    case 'none':
      throw usageFailure(
        'No connection. Use --profile <name>, --socket <path>, or run inside a project.',
      );
    case 'project':
      return await projectConnection(host, profile);
    case 'socket': {
      // A socket given by --socket has no profile URL to check; its path is the argument itself.
      const problem =
        profile.name === undefined
          ? undefined
          : profile.url === undefined
            ? 'The profile has no URL.'
            : profileUrlProblem(profile.url);
      if (problem !== undefined) throw usageFailure(problem);
      return socketConnection(host, profile);
    }
    case 'remote':
      return remoteConnection(host, profile);
  }
}
