import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { credentialsFile } from '../../context/credentials-file.ts';
import { profilesFile } from '../../context/profiles-file.ts';
import { usageFailure } from '../../context/usage-failure.ts';

export const profileRemoveCommand: Command<CliContext> = buildCommand<
  NonNullable<unknown>,
  [string],
  CliContext
>({
  docs: { brief: 'Remove a profile and the credential it owns.' },
  parameters: {
    flags: {},
    positional: {
      kind: 'tuple',
      parameters: [{ brief: 'The profile name.', parse: String, placeholder: 'name' }],
    },
  },
  async func(this: CliContext, _flags, name: string) {
    const store = profilesFile(this.host);
    const data = await store.read();
    const profile = data.profiles[name];
    if (profile === undefined) {
      throw usageFailure(`Unknown profile "${name}".`);
    }
    const rest = Object.fromEntries(
      Object.entries(data.profiles).filter(([other]) => other !== name),
    );
    const current = data.current === name ? undefined : data.current;
    await store.write({ profiles: rest, ...(current !== undefined && { current }) });
    const credentials = credentialsFile(this.host);
    const key = profile.credential ?? name;
    const stored = await credentials.read();
    if (
      stored[key] !== undefined &&
      !Object.values(rest).some((other) => (other.credential ?? '') === key)
    ) {
      await credentials.write(
        Object.fromEntries(Object.entries(stored).filter(([other]) => other !== key)),
      );
    }
    this.output.line(`Removed profile ${name}`);
  },
});
