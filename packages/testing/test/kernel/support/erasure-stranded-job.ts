import type { StoredJobSpec } from '@keelwerk/core';
import { expect } from 'vitest';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { DumpQuery } from '../../../src/index.ts';
import { rowsOf, spellingsOf } from './erasure-dump-tools.ts';
import { type FoundEnvelope, openWithoutTag } from './erasure-envelopes.ts';
import { formsFoundIn } from './erasure-forms.ts';
import type { KeyLeft } from './erasure-keys-left.ts';
import type { erasureDumpApp } from './erasure-probe-module.ts';

type Runtime = TestRuntime<typeof erasureDumpApp>;
type Row = Record<string, unknown>;

/** The capability no worker of the harness advertises: only the test takes a job that names it. */
const strandedCapability = 'probe-stranded';
/** What the job's dead letter names, to tell it from the dead jobs of the process. */
const strandedLetter = 'probe.stranded';
/** The shortest lease a take can ask for. */
const leaseMs = 1;
/** One step of the clock past a lease: far below the wait of a retry or of a worker's poll. */
const stepMs = 5;
/** More than the three losses that make a job dead, for a worker that reclaims in between. */
const mostTakes = 8;

const runOf = (row: Row): { action?: unknown; commandId?: unknown; input?: unknown } => {
  const run = typeof row.input === 'string' ? JSON.parse(row.input) : row.input;
  return typeof run === 'object' && run !== null ? run : {};
};

/** The jobs of `probe.defer` that wait for a retry in the command queue (not a timer's job, not the stranded copy). */
async function deferJobs(queries: readonly DumpQuery[]): Promise<readonly Row[]> {
  return (await rowsOf(queries, 'kw_jobs')).filter((row) => {
    const run = runOf(row);
    return (
      row.queue === 'commands' &&
      run.action === 'probe.defer' &&
      !String(run.commandId).startsWith('kernel:timer:') &&
      row.dead_letter !== strandedLetter
    );
  });
}

/** The stranded jobs: the copies this file makes. */
const strandedJobs = async (queries: readonly DumpQuery[]): Promise<readonly Row[]> =>
  (await rowsOf(queries, 'kw_jobs')).filter((row) => row.dead_letter === strandedLetter);

const jsonOf = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

/** The job a copy of `row` is: the same run, principal and scope, in a lane only the test takes from. */
function copyOf(row: Row, at: Temporal.Instant): StoredJobSpec {
  return {
    queue: String(row.queue),
    run: jsonOf(row.input) as StoredJobSpec['run'],
    scope: jsonOf(row.scope) as StoredJobSpec['scope'],
    principal: jsonOf(row.principal) as StoredJobSpec['principal'],
    causation: jsonOf(row.causation) as StoredJobSpec['causation'],
    build: { id: String(row.build_id), revision: Number(row.revision) },
    kind: 'action',
    laneCap: 4,
    createdAt: at,
    capability: [strandedCapability],
    deadLetter: strandedLetter,
  };
}

/**
 * Plants a command job of the operator that ends dead the way a poison job does (9.5.4): the
 * retrying `probe.defer` job is copied into a lane no worker takes from, the test takes the copy
 * with a lease of one millisecond, lets the clock pass the lease by a few milliseconds and takes
 * again, until three lost leases have made it a dead letter. The copy keeps the sealed input.
 * `advance` moves the clock of the runtime on (the clock otherwise stands still).
 */
async function strandDeadJob(input: {
  readonly runtime: Runtime;
  readonly queries: readonly DumpQuery[];
  readonly advance: (ms: number) => void;
}): Promise<void> {
  const { runtime, queries, advance } = input;
  const [original] = await deferJobs(queries);
  expect(original, 'the retrying probe.defer job exists to copy').toBeDefined();
  if (original === undefined) return;
  const spec = copyOf(original, runtime.clock.now());
  const request = {
    limit: 1,
    capabilitySets: [strandedCapability],
    maxRevision: Number(original.revision),
    leaseMs,
  };
  const worker = 'probe.stranding';
  await runtime.adapter.unit(runtime.namespace, spec.scope, async (unit) => {
    await unit.jobs.enqueue(spec);
    await unit.jobs.take('commands', worker, request);
  });
  for (let take = 0; take < mostTakes; take += 1) {
    const [job] = await strandedJobs(queries);
    if (job?.state === 'dead') return;
    advance(stepMs);
    await runtime.adapter.unit(runtime.namespace, spec.scope, async (unit) => {
      await unit.jobs.take('commands', worker, request);
    });
  }
  expect((await strandedJobs(queries))[0]?.state, 'three lost leases end the job dead').toBe(
    'dead',
  );
}

/** The address a stranded job stores, sealed under the data key of its subject. */
function sealedAddressOf(row: Row): FoundEnvelope | undefined {
  const sealed = (runOf(row).input as { readonly address?: Record<string, unknown> } | undefined)
    ?.address;
  if (
    sealed === undefined ||
    typeof sealed.k !== 'string' ||
    typeof sealed.n !== 'string' ||
    typeof sealed.c !== 'string'
  ) {
    return undefined;
  }
  return {
    table: 'kw_jobs',
    kind: 'kwe',
    ...(sealed.$kwe === 1 || sealed.$kwe === 2 ? { version: sealed.$kwe } : {}),
    keyId: sealed.k,
    nonce: Buffer.from(sealed.n, 'base64url'),
    sealed: Buffer.from(sealed.c, 'base64url'),
  };
}

/** Before the erasure: the dead job of the operator holds the address sealed under the subject's key, and that key opens it. */
async function expectStrandedJobOpens(
  queries: readonly DumpQuery[],
  key: { readonly id: string; readonly material: Uint8Array },
  address: string,
): Promise<void> {
  const [job] = await strandedJobs(queries);
  expect(job?.state, 'the stranded job is dead before the erasure').toBe('dead');
  const envelope = job === undefined ? undefined : sealedAddressOf(job);
  expect(envelope?.keyId, 'its address is sealed under the subject key').toBe(key.id);
  if (envelope === undefined) return;
  // A member is sealed as its JSON text.
  expect(openWithoutTag(envelope, key.material)?.toString('utf8')).toBe(JSON.stringify(address));
}

/**
 * After the erasure: the dead job of the operator is still there (an erasure purges only the jobs
 * whose principal is the subject), its envelope is the one under the destroyed key, no key that is
 * left opens it to the address, and neither its input nor its dead letter holds a marker.
 */
async function expectStrandedJobUnreadable(input: {
  readonly queries: readonly DumpQuery[];
  readonly keyId: string;
  readonly keys: readonly KeyLeft[];
  readonly address: string;
  readonly markers: readonly string[];
}): Promise<void> {
  const { queries, keyId, keys, address, markers } = input;
  const jobs = await strandedJobs(queries);
  expect(jobs.length, "the operator's dead job is kept (D7)").toBe(1);
  const [job] = jobs;
  const envelope = job === undefined ? undefined : sealedAddressOf(job);
  expect(envelope?.keyId, 'its address is still sealed under the destroyed key').toBe(keyId);
  if (envelope === undefined) return;
  for (const key of keys) {
    const opened = openWithoutTag(envelope, key.material)?.toString('utf8') ?? '';
    expect(opened, `${key.label} does not open the stranded address`).not.toContain(address);
  }
  const text = JSON.stringify([job?.input, job?.dead_letter]);
  // The input names the subject's id in the clear (a `field.subject()` member); the inventory keeps it.
  expect(formsFoundIn(text, markers)).toEqual([]);
}

/** After the erasure: the `probe.defer` job that waits for its retry is still in `kw_jobs` (D7), so the checks of the envelopes cover it. */
async function expectDeferJobKept(queries: readonly DumpQuery[]): Promise<void> {
  const jobs = await deferJobs(queries);
  expect(jobs.length, 'the probe.defer job of the operator is still in kw_jobs (D7)').toBe(1);
  expect(['scheduled', 'available']).toContain(jobs[0]?.state);
}

/**
 * The deadline job of an outside performer's effect (queue `timers`, key `core.deadline:<effect id>`)
 * is there, and its key and its input hold the effect id and nothing else: none of the `forbidden`
 * texts (the subject's id, its session, its rows, the markers) is in either, in any form.
 */
async function expectDeadlineJobHoldsEffectIdOnly(
  queries: readonly DumpQuery[],
  forbidden: readonly string[],
  when: string,
): Promise<void> {
  const jobs = (await rowsOf(queries, 'kw_jobs')).filter((row) =>
    String(row.key ?? '').startsWith('core.deadline:'),
  );
  expect(jobs.length, `the deadline job of the outside effect is in kw_jobs ${when}`).toBe(1);
  const [job] = jobs;
  if (job === undefined) return;
  const run = jsonOf(job.input) as Record<string, unknown>;
  expect(Object.keys(run), 'its input names the effect and nothing else').toEqual([
    'effectDeadline',
  ]);
  expect(job.key).toBe(`core.deadline:${String(run.effectDeadline)}`);
  const found = formsFoundIn(JSON.stringify([job.key, job.input]), [
    ...forbidden,
    ...forbidden.flatMap(spellingsOf),
  ]);
  expect(found, 'its key and input hold no id of the subject and no marker').toEqual([]);
}

export {
  expectDeadlineJobHoldsEffectIdOnly,
  expectDeferJobKept,
  expectStrandedJobOpens,
  expectStrandedJobUnreadable,
  strandDeadJob,
};
