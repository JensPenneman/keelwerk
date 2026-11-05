import { execFile } from 'node:child_process';
import process from 'node:process';
import type { ArtefactRun } from './artefact-run.ts';

/** Runs a script of the workspace with the running Node, in `root`; never rejects. */
export function runScript(
  root: string,
  script: string,
  args: readonly string[],
): Promise<ArtefactRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--conditions=@keelwerk/source', script, ...args],
      { cwd: root, timeout: 120_000 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, output: `${stdout}${stderr}`.trim() });
      },
    );
  });
}
