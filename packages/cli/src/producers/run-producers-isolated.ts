import { execFile } from 'node:child_process';
import process from 'node:process';
import type { ProducerResult } from './producer-result.ts';
import type { RunProducersOptions } from './run-producers.ts';
import { runProducers } from './run-producers.ts';

const condition = '@keelwerk/source';

const childScript = [
  'const [url, text] = process.argv.slice(1);',
  'const { runProducers } = await import(url);',
  'const result = await runProducers(JSON.parse(text));',
  "process.stdout.write('\\n' + JSON.stringify(result) + '\\n');",
].join('\n');

function hasSourceCondition(): boolean {
  return process.execArgv.some((argument) => argument.includes(condition));
}

function resultOf(stdout: string): ProducerResult {
  const last = stdout.trim().split('\n').at(-1) ?? '';
  return JSON.parse(last) as ProducerResult;
}

/**
 * `runProducers` under the `@keelwerk/source` condition, so the module packages of a project
 * resolve to their sources and not to a stale or missing `dist` (section 13.7). When this process
 * already runs with the condition the producers run in it; otherwise they run in a child Node that
 * has it, one fresh process per run. In-process runs share Node's ESM cache: a second run in the
 * same process sees the definitions of the first, so a watch loop (WP-61) must use a child per
 * run or restart the process; it cannot call `runProducers` twice in one process.
 */
export async function runProducersIsolated(options: RunProducersOptions): Promise<ProducerResult> {
  if (hasSourceCondition()) return runProducers(options);
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const target = new URL(`./run-producers${ext}`, import.meta.url).href;
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        `--conditions=${condition}`,
        '--input-type=module',
        '-e',
        childScript,
        target,
        JSON.stringify(options),
      ],
      { cwd: options.root, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`${stderr}`.trim() === '' ? error.message : `${stderr}`.trim()));
          return;
        }
        try {
          resolve(resultOf(stdout));
        } catch {
          reject(new Error(`the producers printed no result: ${`${stdout}${stderr}`.trim()}`));
        }
      },
    );
  });
}
