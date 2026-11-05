import type { ApiSurface } from '@keelwerk/core';
import { proposeCompletions, run } from '@stricli/core';
import { buildCliApp } from './build-cli-app.ts';
import type { CliIo } from './cli-io.ts';
import type { CliContext } from './context/cli-context.ts';
import { CliFailure } from './context/cli-failure.ts';
import { createUntypedClient } from './context/create-untyped-client.ts';
import type { DeploymentLink } from './context/deployment-link.ts';
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
const profileCommands = new Set(['explain', 'operator', 'migrate']);
/** The subcommands of a group that do the same: `db apply|status|verify` (WP-59). */
const profileSubcommands: Readonly<Record<string, ReadonlySet<string>>> = {
  db: new Set(['apply', 'status', 'verify']),
};
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
  let link: DeploymentLink | undefined;
  try {
    const [command, subcommand] = words;
    const profiled =
      command !== undefined &&
      (profileCommands.has(command) ||
        (subcommand !== undefined && profileSubcommands[command]?.has(subcommand) === true));
    if (profiled && !completing) {
      profile = await resolveProfile(io.host, options);
    }
    if (words[0] === 'call') {
      profile = await resolveProfile(io.host, options);
      try {
        link = completing ? undefined : resolveConnection(io.host, profile);
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
      return determineExitCode(failure);
    }
    throw failure;
  }
  const app = buildCliApp(surface);
  const context: CliContext & { readonly locale: string } = {
    locale: 'en',
    process: io.process,
    surface: surface ?? emptySurface(),
    client: createUntypedClient(
      async () => link ?? resolveConnection(io.host, profile),
      io.host,
      surface?.apiVersion,
    ),
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
  await run(app, words, context);
  return exitCodeOf(io.process.exitCode);
}
