import type { CliHost } from './cli-host.ts';
import { credentialsFile } from './credentials-file.ts';
import { findDeploymentFile } from './find-deployment-file.ts';
import type { GlobalOptions } from './global-options.ts';
import { profilesFile } from './profiles-file.ts';
import type { ResolvedProfile } from './resolved-profile.ts';
import { usageFailure } from './usage-failure.ts';

function overrides(options: GlobalOptions, profile?: { backend?: string; tenant?: string }) {
  const backend = options.backend ?? profile?.backend;
  const tenant = options.tenant ?? profile?.tenant;
  return {
    ...(backend !== undefined && { backend }),
    ...(tenant !== undefined && { tenant }),
  };
}

/**
 * Chooses the connection: `--socket`, else `--profile`, `KEELWERK_PROFILE` or the file's current
 * profile, else the project's deployment file. `KEELWERK_TOKEN` overrides the stored credential.
 */
export async function resolveProfile(
  host: CliHost,
  options: GlobalOptions,
): Promise<ResolvedProfile> {
  if (options.socket !== undefined) {
    const socketPath = options.socket.startsWith('/')
      ? options.socket
      : `${host.cwd}/${options.socket}`;
    return {
      kind: 'socket',
      url: `unix://${socketPath}`,
      socketPath,
      ...overrides(options),
    };
  }
  const file = await profilesFile(host).read();
  const wanted = options.profile ?? host.env.KEELWERK_PROFILE ?? file.current;
  if (wanted !== undefined && wanted !== '') {
    const profile = file.profiles[wanted];
    if (profile === undefined) {
      throw usageFailure(`Unknown profile "${wanted}". Add it with: keelwerk profile add`);
    }
    if (profile.url.startsWith('unix:')) {
      const socketPath = decodeURIComponent(new URL(profile.url).pathname);
      return {
        kind: 'socket',
        name: wanted,
        url: profile.url,
        socketPath,
        ...overrides(options, profile),
      };
    }
    const environmentToken = host.env.KEELWERK_TOKEN;
    const stored = (await credentialsFile(host).read())[profile.credential ?? wanted]?.token;
    const token =
      environmentToken !== undefined && environmentToken !== '' ? environmentToken : stored;
    return {
      kind: 'remote',
      name: wanted,
      url: profile.url,
      ...overrides(options, profile),
      ...(token !== undefined && { token }),
    };
  }
  const configPath = await findDeploymentFile(host, options.config);
  return configPath === undefined
    ? { kind: 'none', ...overrides(options) }
    : { kind: 'project', configPath, ...overrides(options) };
}
