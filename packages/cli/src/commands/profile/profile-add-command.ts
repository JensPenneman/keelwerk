import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { credentialsFile } from '../../context/credentials-file.ts';
import { profileUrlProblem } from '../../context/profile-url-problem.ts';
import { profilesFile } from '../../context/profiles-file.ts';
import { usageFailure } from '../../context/usage-failure.ts';

interface AddFlags {
  readonly backend?: string;
  readonly tenant?: string;
  readonly 'token-stdin'?: boolean;
  readonly use?: boolean;
}

export const profileAddCommand: Command<CliContext> = buildCommand<
  AddFlags,
  [string, string],
  CliContext
>({
  docs: {
    brief: 'Add or replace a profile.',
    fullDescription:
      'The URL is https://, unix:// or http:// to a loopback host. With --token-stdin the token is read from standard input and stored apart, with mode 0600.',
  },
  parameters: {
    flags: {
      backend: { kind: 'parsed', parse: String, brief: 'The backend to address.', optional: true },
      tenant: { kind: 'parsed', parse: String, brief: 'The tenant to address.', optional: true },
      'token-stdin': {
        kind: 'boolean',
        brief: 'Store a token read from standard input.',
        optional: true,
      },
      use: { kind: 'boolean', brief: 'Make it the current profile.', optional: true },
    },
    positional: {
      kind: 'tuple',
      parameters: [
        { brief: 'The profile name.', parse: String, placeholder: 'name' },
        { brief: 'The deployment URL.', parse: String, placeholder: 'url' },
      ],
    },
  },
  async func(this: CliContext, flags: AddFlags, name: string, url: string) {
    const problem = profileUrlProblem(url);
    if (problem !== undefined) {
      throw usageFailure(problem);
    }
    const store = profilesFile(this.host);
    const data = await store.read();
    const profile = {
      url,
      ...(flags.backend !== undefined && { backend: flags.backend }),
      ...(flags.tenant !== undefined && { tenant: flags.tenant }),
    };
    const first = Object.keys(data.profiles).length === 0;
    const current = flags.use === true || first ? name : data.current;
    await store.write({
      profiles: { ...data.profiles, [name]: profile },
      ...(current !== undefined && { current }),
    });
    if (flags['token-stdin'] === true) {
      const token = (await this.host.readStdin()).trim();
      if (token === '') {
        throw usageFailure('The token on standard input is empty.');
      }
      const credentials = credentialsFile(this.host);
      await credentials.write({ ...(await credentials.read()), [name]: { token } });
    }
    this.output.line(`Saved profile ${name}`);
  },
});
