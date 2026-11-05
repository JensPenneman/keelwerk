import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { credentialsFile } from '../../context/credentials-file.ts';
import { commonFlags } from '../../routes/common-flags.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { credentialKeyOf } from './credential-key-of.ts';

/** `logout` (section 16.9.6): removes the profile's credential from `credentials.json`; the deployment's session is left to expire. */
export const logoutCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: { brief: "Forget the profile's credential." },
  parameters: {
    flags: {
      profile: commonFlags().profile,
      output: commonFlags().output,
    },
  } as never,
  async func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    try {
      const key = await credentialKeyOf(scoped.host, scoped.profile);
      const store = credentialsFile(scoped.host);
      const { [key]: removed, ...rest } = await store.read();
      if (removed !== undefined) await store.write(rest);
      scoped.output.line(
        removed === undefined
          ? `No credential stored for ${scoped.profile.name ?? key}`
          : `Signed out of ${scoped.profile.name ?? key}`,
      );
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
