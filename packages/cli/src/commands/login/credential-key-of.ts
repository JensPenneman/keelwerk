import type { CliHost } from '../../context/cli-host.ts';
import { profilesFile } from '../../context/profiles-file.ts';
import type { ResolvedProfile } from '../../context/resolved-profile.ts';
import { usageFailure } from '../../context/usage-failure.ts';

/**
 * The key of the profile's entry in `credentials.json` (section 16.9.6): the profile's `credential`,
 * else its name. A connection that is no named profile has nowhere to keep a credential.
 */
export async function credentialKeyOf(host: CliHost, profile: ResolvedProfile): Promise<string> {
  const { name } = profile;
  if (name === undefined || profile.kind === 'project') {
    throw usageFailure(
      'This needs a named profile to keep the credential: pass --profile <name> or add one with `keelwerk profile add`.',
    );
  }
  if (profile.kind === 'socket') {
    throw usageFailure(
      'The operator socket needs no credential: connecting to it is the proof of access.',
    );
  }
  const entry = (await profilesFile(host).read()).profiles[name];
  return entry?.credential ?? name;
}
