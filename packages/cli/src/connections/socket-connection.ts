import type { CliHost } from '../context/cli-host.ts';
import { createHttpLink } from '../context/create-http-link.ts';
import type { ResolvedProfile } from '../context/resolved-profile.ts';
import { backendIdOf } from './backend-id-of.ts';
import type { OpenedConnection } from './opened-connection.ts';

/**
 * The operator socket (section 16.9.1): the invocation protocol over the Unix socket the profile or
 * `--socket` names. Connecting to the socket is the proof of operator access, so no credential is
 * sent unless the profile holds one. Headers carry ids (16.8.2): with a tenant marker and a backend
 * given by name, the name is looked up once over a deployment-level link, and the real link sends
 * the backend's id.
 */
export async function socketConnection(
  host: CliHost,
  profile: ResolvedProfile,
): Promise<OpenedConnection> {
  const { backend } = profile;
  if (profile.tenant === undefined || backend === undefined || backend.startsWith('bknd_')) {
    return { link: createHttpLink(host, profile), close: async () => undefined };
  }
  const { tenant: _tenant, backend: _backend, ...deploymentLevel } = profile;
  const id = await backendIdOf(createHttpLink(host, deploymentLevel), backend);
  return { link: createHttpLink(host, { ...profile, backend: id }), close: async () => undefined };
}
