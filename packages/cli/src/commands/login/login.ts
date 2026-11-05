import type { SurfaceAction } from '@keelwerk/core';
import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { CliFailure } from '../../context/cli-failure.ts';
import { credentialsFile } from '../../context/credentials-file.ts';
import { localFailure } from '../../context/local-failure.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { commonFlags } from '../../routes/common-flags.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { readInputArgument } from '../../routes/read-input-argument.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { credentialKeyOf } from './credential-key-of.ts';
import { loginActionsOf } from './login-actions-of.ts';
import { promptLoginInputs } from './prompt-login-inputs.ts';

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function chosen(context: CliContext, flags: Readonly<Record<string, unknown>>): SurfaceAction {
  const candidates = loginActionsOf(context.surface);
  const wanted = typeof flags.action === 'string' ? flags.action : undefined;
  if (wanted !== undefined) {
    const named = candidates.find((candidate) => candidate.ref === wanted);
    if (named === undefined)
      throw usageFailure(`"${wanted}" is not a login action of this deployment.`);
    return named;
  }
  const [only] = candidates;
  if (only !== undefined && candidates.length === 1) return only;
  if (only === undefined) {
    throw usageFailure(
      'The deployment offers no login action. Store a token with `keelwerk login --token`.',
    );
  }
  throw usageFailure(
    `The deployment offers several login actions; choose one with --action: ${candidates
      .map((candidate) => candidate.ref)
      .join(', ')}.`,
  );
}

async function pastedToken(context: CliContext): Promise<string> {
  const { host } = context;
  const text = host.stdinInteractive
    ? await host.promptSecret('token')
    : (await host.readStdin()).trim();
  if (text.trim() === '') throw usageFailure('The token is empty.');
  return text.trim();
}

async function tokenFromLogin(
  context: CliContext,
  flags: Readonly<Record<string, unknown>>,
): Promise<string> {
  const action = chosen(context, flags);
  const tokenField = action.hints.cli?.login?.tokenField ?? 'token';
  const given =
    typeof flags.input === 'string' ? recordOf(await readInputArgument(context, flags.input)) : {};
  const input = await promptLoginInputs(context.host, action, given);
  // run-cli opened the connection without the stored credential, so a stale one is never sent first.
  const response = await context.client.invoke(action.ref, input, {
    signal: context.signal,
    commandId: context.host.newId(),
  });
  if (!response.ok) throw new CliFailure(response.error, response.error.message);
  const token = recordOf(response.value)[tokenField];
  if (typeof token !== 'string' || token === '') {
    throw localFailure(
      'internal',
      'cli.login_without_token',
      `"${action.ref}" answered without a "${tokenField}" to keep.`,
    );
  }
  return token;
}

/**
 * `login [--token] [--action <ref>] [--input json]` (section 16.9.6): finds the actions that carry
 * a `cli.login` hint, asks for their inputs (a secret without echo), invokes the chosen one and
 * stores the value of its `tokenField` as the profile's credential. `--token` stores a pasted token
 * instead. The token is never printed.
 */
export const loginCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Sign in and keep the credential in the profile.',
    fullDescription: [
      "login                     ask for the inputs of the deployment's login action",
      'login --action <ref>      choose one of several login actions',
      'login --input <json>      give inputs; the rest is asked for',
      'login --token             store a token read from the terminal or standard input',
    ].join('\n'),
  },
  parameters: {
    flags: {
      profile: commonFlags().profile,
      config: commonFlags().config,
      output: commonFlags().output,
      input: commonFlags().input,
      action: {
        kind: 'parsed',
        parse: String,
        brief: 'The login action to use.',
        placeholder: 'ref',
        optional: true,
      },
      token: {
        kind: 'boolean',
        brief: 'Store a pasted token instead of signing in.',
        optional: true,
      },
    },
  } as never,
  async func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    try {
      const key = await credentialKeyOf(scoped.host, scoped.profile);
      const token =
        parsed.token === true ? await pastedToken(scoped) : await tokenFromLogin(scoped, parsed);
      const store = credentialsFile(scoped.host);
      await store.write({ ...(await store.read()), [key]: { token } });
      scoped.output.line(`Signed in to ${scoped.profile.name ?? key}`);
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
