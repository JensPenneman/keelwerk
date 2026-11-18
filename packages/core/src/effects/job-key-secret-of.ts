import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { jobKeyInfo } from './job-key-info.ts';

/**
 * The job key secret of the scope a run writes in: the one `runCommand` derived before its unit
 * opened. A run that did not come through it (a dry run) derives it, which never opens a unit
 * there.
 */
export function jobKeySecretOf(run: RunCommandInput): Promise<Uint8Array> {
  return run.jobKeySecret === undefined
    ? run.keys.derive(run.scope, jobKeyInfo, 32)
    : Promise.resolve(run.jobKeySecret);
}
