import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { ProcessRun } from './process-run.ts';
import type { PublishOptions } from './publish-options.ts';
import { publishOrder } from './publish-order.ts';
import { publishRefusal } from './publish-refusal.ts';
import type { PublishRow } from './publish-row.ts';
import { releaseSummary, stoppedSummary } from './release-summary.ts';
import { tarballProblems } from './tarball-problems.ts';

const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const stageFlags = ['--provenance', '--access', 'public', '--tag', 'latest'] as const;

/** The stage id of `version` in the output of `npm stage list <name> --json`, when it names one. */
function stageIdOf(output: string, version: string): string | undefined {
  const search = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = search(item);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (typeof value !== 'object' || value === null) return undefined;
    const record = value as Record<string, unknown>;
    if (record.version === version) {
      const own = JSON.stringify(record).match(uuid);
      if (own !== null) return own[0];
    }
    for (const inner of Object.values(record)) {
      const found = search(inner);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  try {
    return search(JSON.parse(output));
  } catch {
    return undefined;
  }
}

function lastLine(output: string): string {
  const lines = output.split('\n').filter((line) => line.trim() !== '');
  return lines.at(-1)?.trim() ?? 'no output';
}

/** The real runner: `execFile` without a shell, output of both streams, the environment unchanged. */
function processRun(env: Readonly<Record<string, string | undefined>>): ProcessRun {
  return (program, args) =>
    new Promise((resolve) => {
      execFile(
        program,
        [...args],
        { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
          resolve({ code, output: `${stdout}${stderr}` });
        },
      );
    });
}

/** The version and the package names for the summary of a stopped run, whatever can still be read. */
function stoppedContext(root: string): {
  readonly version: string;
  readonly mode: 'staged' | 'trusted';
  readonly names: readonly string[];
} {
  let version = '';
  try {
    const manifest = JSON.parse(
      readFileSync(join(root, '.release-please-manifest.json'), 'utf8'),
    ) as { readonly '.'?: string };
    version = manifest['.'] ?? '';
  } catch {
    // The summary then has no version.
  }
  let names: readonly string[] = [];
  try {
    names = publishOrder(root).map((entry) => entry.name);
  } catch {
    // A broken workspace: the message says why, no package list.
  }
  // biome-ignore lint/style/noProcessEnv: the command-line entry reads the mode from the environment
  const mode = (process.env.NODE_AUTH_TOKEN ?? '') === '' ? 'trusted' : 'staged';
  return { version, mode, names };
}

async function main(argv: readonly string[]): Promise<number> {
  const at = argv.indexOf('--tarballs');
  const tarballs = at === -1 ? undefined : argv[at + 1];
  const dryRun = argv.includes('--dry-run');
  const real = argv.includes('--publish');
  if (tarballs === undefined || dryRun === real || argv.length !== 3) {
    process.stderr.write(
      'Usage: node scripts/publish-packages.ts --tarballs <dir> (--dry-run | --publish)\n',
    );
    return 2;
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  // biome-ignore lint/style/noProcessEnv: the command-line entry hands the environment to the library function
  const env = process.env;
  let rows: readonly PublishRow[];
  try {
    rows = await publishPackages({ root, tarballs, dryRun, env, run: processRun(env) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    if (env.GITHUB_STEP_SUMMARY !== undefined && env.GITHUB_STEP_SUMMARY !== '') {
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `${stoppedSummary({ ...stoppedContext(root), dryRun, message })}\n`,
      );
    }
    return 1;
  }
  const version = rows[0]?.version ?? '';
  const directories = new Map(publishOrder(root).map((entry) => [entry.name, entry.directory]));
  for (const row of rows) {
    const manifestPath = join(root, 'packages', directories.get(row.name) ?? '', 'package.json');
    const license = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { license?: string })
      .license;
    process.stdout.write(
      `${row.name}@${row.version}  engines node >=26  licence ${license ?? 'none'}  provenance on  ${row.outcome}${row.stageId === undefined ? '' : ` ${row.stageId}`}\n`,
    );
  }
  const summary = releaseSummary({
    version,
    mode: (env.NODE_AUTH_TOKEN ?? '') === '' ? 'trusted' : 'staged',
    dryRun,
    rows,
  });
  process.stdout.write(`\n${summary}`);
  if (env.GITHUB_STEP_SUMMARY !== undefined && env.GITHUB_STEP_SUMMARY !== '') {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  return rows.some((row) => row.outcome === 'failed' || row.outcome === 'not attempted') ? 1 : 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));

/**
 * All of the version or none. Checks every tarball and dry-runs every stage first, then stages in
 * dependency order, stopping at the first failure. Returns one row per package of `publishOrder(root)`;
 * throws before any npm call that writes when a real run is refused, a tarball has problems or a dry
 * run fails.
 */
export async function publishPackages(options: PublishOptions): Promise<readonly PublishRow[]> {
  const { root, tarballs, dryRun, env, run } = options;
  const packages = publishOrder(root);
  const manifest = JSON.parse(
    readFileSync(join(root, '.release-please-manifest.json'), 'utf8'),
  ) as {
    readonly '.'?: string;
  };
  const version = manifest['.'];
  if (version === undefined) throw new Error('.release-please-manifest.json has no "." version');
  const mismatched = packages.filter((entry) => entry.version !== version);
  if (mismatched.length > 0) {
    throw new Error(
      `package versions differ from ${version}: ${mismatched.map((entry) => `${entry.name}@${entry.version}`).join(', ')}`,
    );
  }
  const staged = (env.NODE_AUTH_TOKEN ?? '') !== '';

  if (!dryRun) {
    const tags = await run('git', ['tag', '--points-at', 'HEAD']);
    const npm = await run('npm', ['--version']);
    const refusal = publishRefusal({
      repository: env.GITHUB_REPOSITORY,
      ref: env.GITHUB_REF,
      version,
      tagAtCommit: tags.output.split('\n').some((line) => line.trim() === `v${version}`),
      npmVersion: npm.code === 0 ? npm.output.trim() : '',
    });
    if (refusal !== undefined) throw new Error(refusal);
  }

  const problems: string[] = [];
  for (const entry of packages) {
    const file = join(tarballs, entry.tarball);
    const json = await run('tar', ['-xzOf', file, 'package/package.json']);
    const listing = await run('tar', ['-tzf', file]);
    if (json.code !== 0 || listing.code !== 0) {
      problems.push(
        `${entry.name}: cannot read ${entry.tarball}: ${lastLine(json.output + listing.output)}`,
      );
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json.output);
    } catch {
      problems.push(`${entry.name}: package/package.json in ${entry.tarball} is not JSON`);
      continue;
    }
    const files = listing.output
      .split('\n')
      .filter((line) => line.startsWith('package/'))
      .map((line) => line.slice('package/'.length));
    problems.push(
      ...tarballProblems(parsed, files, {
        name: entry.name,
        version,
        directory: entry.directory,
      }),
    );
  }
  if (problems.length > 0)
    throw new Error(`the tarballs are not fit to stage:\n${problems.join('\n')}`);

  const rows = new Map<string, PublishRow>();
  for (const entry of packages) {
    const view = await run('npm', ['view', `${entry.name}@${version}`, 'version', '--json']);
    if (view.code === 0 && view.output.includes(version)) {
      rows.set(entry.name, { name: entry.name, version, outcome: 'already published' });
      continue;
    }
    if (staged) {
      const list = await run('npm', ['stage', 'list', entry.name, '--json']);
      if (list.code === 0 && list.output.includes(`"${version}"`)) {
        const stageId = stageIdOf(list.output, version);
        rows.set(entry.name, {
          name: entry.name,
          version,
          outcome: 'already staged',
          ...(stageId === undefined ? {} : { stageId }),
        });
      }
    }
  }

  const pending = packages.filter((entry) => !rows.has(entry.name));
  for (const entry of pending) {
    const check = await run('npm', [
      'stage',
      'publish',
      join(tarballs, entry.tarball),
      '--dry-run',
      ...stageFlags,
    ]);
    if (check.code !== 0) {
      throw new Error(`the dry run of ${entry.name}@${version} failed: ${lastLine(check.output)}`);
    }
  }
  if (dryRun) {
    return packages.map(
      (entry) => rows.get(entry.name) ?? { name: entry.name, version, outcome: 'dry run' },
    );
  }

  let stopped = false;
  for (const entry of pending) {
    if (stopped) {
      rows.set(entry.name, { name: entry.name, version, outcome: 'not attempted' });
      continue;
    }
    const result = await run('npm', [
      'stage',
      'publish',
      join(tarballs, entry.tarball),
      ...stageFlags,
    ]);
    if (result.code === 0) {
      let stageId = result.output.match(uuid)?.[0];
      if (stageId === undefined && staged) {
        const list = await run('npm', ['stage', 'list', entry.name, '--json']);
        stageId = stageIdOf(list.output, version);
      }
      rows.set(entry.name, {
        name: entry.name,
        version,
        outcome: 'staged',
        ...(stageId === undefined ? {} : { stageId }),
      });
    } else if (/\bstaged\b/i.test(result.output) && /exist/i.test(result.output)) {
      rows.set(entry.name, { name: entry.name, version, outcome: 'already staged' });
    } else {
      rows.set(entry.name, {
        name: entry.name,
        version,
        outcome: 'failed',
        detail: lastLine(result.output),
      });
      stopped = true;
    }
  }
  return packages.map(
    (entry) =>
      rows.get(entry.name) ?? { name: entry.name, version, outcome: 'not attempted' as const },
  );
}
