import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { credentialsFile } from '../../context/credentials-file.ts';
import { profilesFile } from '../../context/profiles-file.ts';
import { usageFailure } from '../../context/usage-failure.ts';

export const profileShowCommand: Command<CliContext> = buildCommand<
  NonNullable<unknown>,
  [string?],
  CliContext
>({
  docs: { brief: 'Show a profile (the current one by default); the token is never printed.' },
  parameters: {
    flags: {},
    positional: {
      kind: 'tuple',
      parameters: [
        { brief: 'The profile name.', parse: String, placeholder: 'name', optional: true },
      ],
    },
  },
  async func(this: CliContext, _flags, name?: string) {
    const data = await profilesFile(this.host).read();
    const wanted = name ?? data.current;
    const profile = wanted === undefined ? undefined : data.profiles[wanted];
    if (wanted === undefined || profile === undefined) {
      throw usageFailure(
        name === undefined ? 'There is no current profile.' : `Unknown profile "${name}".`,
      );
    }
    const credentials = await credentialsFile(this.host).read();
    this.output.value({
      name: wanted,
      current: wanted === data.current,
      ...profile,
      credential: credentials[profile.credential ?? wanted] === undefined ? 'none' : 'stored',
    });
  },
});
