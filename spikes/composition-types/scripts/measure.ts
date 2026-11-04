import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { type Layout, writeSyntheticWorkspace } from './generate-synthetic.ts';

interface Diagnostics {
  readonly instantiations: number;
  readonly checkTime: string;
  readonly errors: readonly string[];
}

const spikeDir = join(import.meta.dirname, '..');
const repo = join(spikeDir, '..', '..');
const [outDir = join(spikeDir, '.measure'), tsc = join(repo, 'node_modules', '.bin', 'tsc')] =
  process.argv.slice(2);
const typeRoots = join(repo, 'node_modules', '@types');

function run(args: readonly string[], cwd: string): string {
  try {
    return execFileSync(tsc, [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const failed = error as { readonly stdout?: string; readonly stderr?: string };
    return `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
  }
}

function diagnostics(output: string): Diagnostics {
  const instantiations = Number(output.match(/Instantiations:\s+(\d+)/)?.[1] ?? Number.NaN);
  const checkTime = output.match(/Check time:\s+([\d.]+s)/)?.[1] ?? '?';
  const errors = output.split('\n').filter((line) => /error TS\d+/.test(line));
  return { instantiations, checkTime, errors };
}

function declarationBytes(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) total += declarationBytes(path);
    else if (name.endsWith('.d.ts')) total += statSync(path).size;
  }
  return total;
}

const rows: string[] = [];
let baseline = { mono: 0, app: 0 };
for (const count of [0, 3, 12, 25, 40]) {
  const result: Record<string, string> = { modules: String(count) };
  for (const layout of ['files', 'single'] satisfies Layout[]) {
    const root = join(outDir, `${layout}-${count}`);
    writeSyntheticWorkspace(root, count, layout, spikeDir, typeRoots);
    const mono = diagnostics(run(['-p', 'tsconfig.mono.json', '--extendedDiagnostics'], root));
    if (count === 0) baseline = { ...baseline, mono: mono.instantiations };
    result[`${layout}.mono`] =
      `${mono.instantiations - baseline.mono} (${mono.checkTime})${mono.errors.length ? ` ERR ${mono.errors.length}` : ''}`;
    if (layout === 'files') {
      const build = diagnostics(run(['-b', 'tsconfig.json'], root));
      rmSync(join(root, 'app', 'tsconfig.tsbuildinfo'), { force: true });
      const app = diagnostics(
        run(['-p', join('app', 'tsconfig.json'), '--extendedDiagnostics'], root),
      );
      if (count === 0) baseline = { ...baseline, app: app.instantiations };
      const sizes = Array.from({ length: count }, (_, i) =>
        declarationBytes(join(root, 'packages', `m${String(i + 1).padStart(2, '0')}`, 'dist')),
      );
      const special = build.errors.filter((line) => /TS7056|TS2742|TS4023/.test(line)).length;
      result['build'] =
        build.errors.length === 0
          ? 'ok'
          : `${build.errors.length} errors (${special} TS7056/TS2742/TS4023): ${build.errors[0]}`;
      result['app'] = `${app.instantiations - baseline.app} (${app.checkTime})`;
      result['dts'] = sizes.length
        ? `${Math.min(...sizes)}-${Math.max(...sizes)} B, mean ${Math.round(sizes.reduce((x, y) => x + y, 0) / sizes.length)} B`
        : '-';
      if (count === 3) {
        const iso = diagnostics(
          run(
            [
              '-p',
              join('packages', 'm03', 'tsconfig.json'),
              '--isolatedDeclarations',
              '--outDir',
              join(root, 'isolated-out'),
            ],
            root,
          ),
        );
        const codes = [
          ...new Set(iso.errors.map((line) => line.match(/error (TS\d+)/)?.[1] ?? '?')),
        ]
          .sort()
          .join(', ');
        result['isolatedDeclarations'] = `m03: ${iso.errors.length} errors (${codes})`;
      }
    }
  }
  rows.push(JSON.stringify(result));
}
process.stdout.write(`baseline: ${JSON.stringify(baseline)}\n${rows.join('\n')}\n`);
