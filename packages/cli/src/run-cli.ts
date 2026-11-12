import type { ApiSurface } from '@keelwerk/core';
import { proposeCompletions, run } from '@stricli/core';
import { buildCliApp } from './build-cli-app.ts';
import type { CliIo } from './cli-io.ts';
import type { OpenedConnection } from './connections/opened-connection.ts';
import type { CliContext } from './context/cli-context.ts';
import { CliFailure } from './context/cli-failure.ts';
import { createUntypedClient } from './context/create-untyped-client.ts';
import { deploymentLevelProfile } from './context/deployment-level-profile.ts';
import { emptySurface } from './context/empty-surface.ts';
import { loadSurface } from './context/load-surface.ts';
import { resolveConnection } from './context/resolve-connection.ts';
import { resolveProfile } from './context/resolve-profile.ts';
import { scanGlobalOptions } from './context/scan-global-options.ts';
import { determineExitCode } from './determine-exit-code.ts';
import { exitCodeOf } from './exit-code-of.ts';
import { createOutputWriter } from './output/create-output-writer.ts';
import { renderError } from './output/render-error.ts';

/** Command words that run against the connected deployment but need no surface, so only the profile is resolved for them (change note, WP-45; WP-58 and WP-61 add theirs). */
const profileCommands = new Set([
  'explain',
  'operator',
  'migrate',
  'login',
  'logout',
  'backend',
  'tenant',
]);
/** The subcommands of a group that do the same: `db apply|status|verify` (WP-59). */
const profileSubcommands: Readonly<Record<string, ReadonlySet<string>>> = {
  db: new Set(['apply', 'status', 'verify']),
  surface: new Set(['usage', 'retire']),
};
/** The profile without its credential. */
function withoutToken(profile: CliContext['profile']): CliContext['profile'] {
  const { token: _token, ...rest } = profile;
  return rest;
}
const helpFlags = new Set(['--help', '-h', '-H']);

/**
 * Runs the CLI once and returns the exit code. A command under `call` needs the surface, so the
 * connection is resolved first (flags, environment, profile files) and the surface is loaded
 * through the cache; every other command runs without a connection.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const completing = argv[0] === '__complete';
  const words = completing ? argv.slice(1) : argv;
  const output = createOutputWriter(io.process, { interactive: io.host.interactive });
  const options = scanGlobalOptions(words);
  let surface: ApiSurface | undefined;
  let profile: CliContext['profile'] = { kind: 'none' };
  let opened: OpenedConnection | undefined;
  const open = async (): Promise<OpenedConnection> => {
    opened ??= await resolveConnection(io.host, profile);
    return opened;
  };
  try {
    const [command, subcommand] = words;
    const profiled =
      command !== undefined &&
      (profileCommands.has(command) ||
        (subcommand !== undefined && profileSubcommands[command]?.has(subcommand) === true));
    if (profiled && !completing) {
      profile = deploymentLevelProfile(
        command,
        options,
        await resolveProfile(io.host, options),
        subcommand,
      );
    }
    const needsSurface =
      command === 'call' ||
      (command === 'introspect' && subcommand !== 'diff') ||
      (command === 'login' && !words.includes('--token') && profile.kind === 'remote');
    if (needsSurface) {
      profile = await resolveProfile(io.host, options);
      // A stored credential is not sent to the login that replaces it.
      if (command === 'login') profile = withoutToken(profile);
      try {
        const link = completing ? undefined : (await open()).link;
        surface = await loadSurface(io.host, profile, link, {
          offline: completing,
          signal: io.signal,
        });
      } catch (failure) {
        if (!words.some((word) => helpFlags.has(word)) && !completing) {
          throw failure;
        }
      }
    }
  } catch (failure) {
    if (failure instanceof CliFailure) {
      if (failure.outcome === 'usage' || failure.outcome === 'interrupted') {
        output.note(`error: ${failure.message}`);
      } else {
        io.process.stderr.write(`${renderError(failure.outcome, false)}\n`);
      }
      await (opened as OpenedConnection | undefined)?.close();
      return determineExitCode(failure);
    }
    await (opened as OpenedConnection | undefined)?.close();
    throw failure;
  }
  const app = buildCliApp(surface, {
    onSkippedAlias: (alias, reference) =>
      output.note(
        `warning: the alias "${alias}" of ${reference} is not routed: the name is taken.`,
      ),
  });
  const context: CliContext & { readonly locale: string } = {
    locale: 'en',
    process: io.process,
    surface: surface ?? emptySurface(),
    client: createUntypedClient(async () => (await open()).link, io.host, surface?.apiVersion),
    output,
    profile,
    signal: io.signal,
    host: io.host,
  };
  if (completing) {
    for (const proposal of await proposeCompletions(app, words, context)) {
      io.process.stdout.write(`${proposal.completion}\n`);
    }
    return 0;
  }
  try {
    await run(app, words, context);
  } finally {
    await (opened as OpenedConnection | undefined)?.close();
  }
  return exitCodeOf(io.process.exitCode);
}
