import type { CliHost } from '../context/cli-host.ts';
import { createHttpLink } from '../context/create-http-link.ts';
import { profileUrlProblem } from '../context/profile-url-problem.ts';
import type { ResolvedProfile } from '../context/resolved-profile.ts';
import { usageFailure } from '../context/usage-failure.ts';
import type { OpenedConnection } from './opened-connection.ts';

/**
 * A remote deployment (section 16.9.1): the invocation protocol over `https://`, or `http://` to a
 * loopback host (S-42), with the profile's credential as the bearer token. Any other URL is a
 * usage mistake, not a connection attempt.
 */
export function remoteConnection(host: CliHost, profile: ResolvedProfile): OpenedConnection {
  const problem =
    profile.url === undefined ? 'The profile has no URL.' : profileUrlProblem(profile.url);
  if (problem !== undefined) throw usageFailure(problem);
  return { link: createHttpLink(host, profile), close: async () => undefined };
}
