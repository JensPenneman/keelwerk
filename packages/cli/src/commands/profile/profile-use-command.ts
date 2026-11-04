import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { profilesFile } from '../../context/profiles-file.ts';
import { usageFailure } from '../../context/usage-failure.ts';

export const profileUseCommand: Command<CliContext> = buildCommand<
  NonNullable<unknown>,
  [string],
  CliContext
>({
  docs: { brief: 'Make a profile the current one.' },
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
    if (data.profiles[name] === undefined) {
      throw usageFailure(`Unknown profile "${name}".`);
    }
    await store.write({ ...data, current: name });
    this.output.line(`Current profile: ${name}`);
  },
});
