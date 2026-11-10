import type { CliHost } from '../context/cli-host.ts';
import { runProducers } from '../producers/run-producers.ts';
import type { AppProcess, AppReady } from './app-process.ts';
import { isReady } from './app-process.ts';
import { confirmContract } from './confirm-contract.ts';
import { deferredNote } from './deferred-note.ts';
import type { DevPaths } from './dev-paths.ts';
import { reportSync } from './report-sync.ts';
import { startApp } from './start-app.ts';
import { startProbe } from './start-probe.ts';
import { stopDeadlineMs } from './stop-deadline.ts';

/** The share of the stop deadline the app itself uses, so it ends before it is killed. */
const childDeadlineMs = 1500;

/** What one cycle needs. */
export interface CycleInput {
  readonly host: CliHost;
  readonly paths: DevPaths;
  readonly print: (line: string) => void;
  readonly note: (line: string) => void;
  /** The probe's import limit in milliseconds, its stall limit while a module import is in flight; default: the limit of section 13.6. */
  readonly probeLimitMs?: number;
  /** The app of the previous cycle, still running. */
  readonly running: AppProcess | undefined;
}

/** How one cycle ended. */
export type CycleOutcome =
  | {
      readonly kind: 'running';
      readonly app: AppProcess;
      readonly ready: AppReady;
      readonly ms: number;
    }
  | { readonly kind: 'failed' };

/**
 * One restart (section 13.6): stop the app, rewrite the module manifests, run the probe and the
 * database synchronisation in fresh children, ask about contract steps, start the app. A cycle that
 * fails leaves the app stopped and says why; the next change runs another.
 */
export async function runCycle(input: CycleInput): Promise<CycleOutcome> {
  const { host, paths, print, note } = input;
  const started = host.now();
  await input.running?.stop(stopDeadlineMs);
  const manifests = await runProducers({ root: paths.root, check: false, only: ['manifests'] });
  for (const path of manifests.written) print(`${path} written`);
  for (const failure of manifests.failures) note(failure);
  const probe = await startProbe(
    host,
    { root: paths.root, deployment: paths.deployment, now: host.now(), contract: false },
    input.probeLimitMs,
  );
  if (probe.kind === 'failed') {
    note(probe.message);
    return { kind: 'failed' };
  }
  const { producers, sync } = probe.result;
  for (const path of producers.written) print(`${path} written`);
  for (const line of producers.notes) note(line);
  for (const failure of [...manifests.failures, ...producers.failures]) note(failure);
  if (sync === undefined) return { kind: 'failed' };
  reportSync(sync, print, note);
  if (sync.deferred.length > 0) {
    if (await confirmContract(host, sync.deferred)) {
      const again = await startProbe(
        host,
        { root: paths.root, deployment: paths.deployment, now: host.now(), contract: true },
        input.probeLimitMs,
      );
      if (again.kind === 'failed') {
        note(again.message);
        return { kind: 'failed' };
      }
      for (const failure of again.result.producers.failures) note(failure);
      const second = again.result.sync;
      if (second !== undefined) {
        reportSync(second, print, note);
        // Steps that the live build ids still hold back after the confirmation.
        if (second.deferred.length > 0) note(deferredNote(second.deferred));
      }
    } else {
      note(deferredNote(sync.deferred));
    }
  }
  const app = startApp(
    host,
    { root: paths.root, deployment: paths.deployment, stopDeadlineMs: childDeadlineMs },
    print,
  );
  const outcome = await app.ready;
  if (!isReady(outcome)) {
    note(`the app exited with code ${outcome.code ?? outcome.signal ?? '?'} before it was ready`);
    return { kind: 'failed' };
  }
  return { kind: 'running', app, ready: outcome, ms: host.now() - started };
}
