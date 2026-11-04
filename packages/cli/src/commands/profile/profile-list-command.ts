import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { profilesFile } from '../../context/profiles-file.ts';

export const profileListCommand: Command<CliContext> = buildCommand({
  docs: { brief: 'List the profiles.' },
  parameters: { flags: {} },
  async func(this: CliContext) {
    const data = await profilesFile(this.host).read();
    this.output.value(
      Object.entries(data.profiles).map(([name, profile]) => ({
        name,
        current: name === data.current ? '*' : '',
        url: profile.url,
        backend: profile.backend ?? '',
        tenant: profile.tenant ?? '',
      })),
    );
  },
});
