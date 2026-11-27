import type { StorageScope, Unit } from '@keelwerk/core';
import { openStoredEvents } from '@keelwerk/core';
import type { consumers, ErasureWorker } from '@keelwerk/events';
import { expect } from 'vitest';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { DumpQuery } from '../../../src/index.ts';
import { findPlaintext } from '../../../src/index.ts';
import { sectionsOf } from './dump-sections.ts';
import { expectDeadJobOpens, expectDeadJobUnreadable } from './erasure-dead-job.ts';
import { expectDerivedDataGone } from './erasure-derived-data.ts';
import { dumpMarker, gapMarker } from './erasure-dump-markers.ts';
import { plantMarkers } from './erasure-dump-plant.ts';
import {
  dumpAll,
  emailTagOf,
  openedMarkers,
  plainFingerprint,
  rowsOf,
} from './erasure-dump-tools.ts';
import { envelopesIn } from './erasure-envelopes.ts';
import { formsFoundIn } from './erasure-forms.ts';
import { expectEveryTableNamed, expectKeptReferences } from './erasure-kept-references.ts';
import { keysLeft } from './erasure-keys-left.ts';
import { type KnownGap, knownGaps } from './erasure-known-gaps.ts';
import type { erasureDumpApp } from './erasure-probe-module.ts';
import { recoverMarkers } from './erasure-readers.ts';
import {
  expectDeadlineJobHoldsEffectIdOnly,
  expectDeferJobKept,
  expectStrandedJobOpens,
  expectStrandedJobUnreadable,
  strandDeadJob,
} from './erasure-stranded-job.ts';
import { flushUsage } from './erasure-usage-flush.ts';

/** What the case runs on: the runtime, its two workers and one query per database of the deployment. */
interface DumpCase {
  readonly runtime: TestRuntime<typeof erasureDumpApp>;
  readonly worker: ErasureWorker;
  readonly dispatcher: ReturnType<typeof consumers>;
  /** Moves the runtime's clock on by a few milliseconds. */
  readonly advance: (ms: number) => void;
  /** The owner connection of every database the deployment spans (the control root may be a separate one). */
  readonly queries: readonly DumpQuery[];
}

/**
 * The inventory test of erasure (14.7.5, rule 1) over a database the caller provides, so it runs
 * on PGlite and on PostgreSQL alike: plants a marker through every path that can hold a personal
 * value, proves the control (the kernel reads every marker back before the erasure, and the
 * ciphertext under the subject's key is in every table that should hold it), erases the subject,
 * and proves that the key is gone, that no marker is readable or present in any form, that no
 * sealed value opens to a marker with any key that still exists, that the stream records of owned
 * rows are purged, that every table is named by the inventory, that the subject's id remains only
 * where the inventory says so, and that the gaps that are known are exactly the ones found.
 */
async function runErasureDumpCase(setup: DumpCase): Promise<void> {
  const { runtime, worker, dispatcher, queries, advance } = setup;
  const marker = dumpMarker;
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const {
    ada,
    adaSession,
    adaThread,
    beaThread: _beaThread,
    commands: planted,
  } = await plantMarkers(runtime, operator, queries, async () => {
    await dispatcher.settled();
  });

  // The operator's job that waits for a retry is copied into a job that three lost leases made dead.
  await strandDeadJob({ runtime, queries, advance });

  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme?.id ?? '',
  } as const;
  const inTenant = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
    runtime.sealed.unit(runtime.namespace, scope, fn);

  /** What the kernel reads back for the tenant, through its keys: rows and events. */
  const readBack = (): Promise<string> =>
    inTenant(async (unit) => {
      const parts: unknown[] = [];
      for (const entry of runtime.app.registry.entities.values()) {
        if (entry.descriptor.tenancy !== 'tenant') continue;
        parts.push((await unit.rows.find(entry.descriptor, { includeArchived: true })).rows);
      }
      const events = (await unit.events.readAll(null, { limit: 1000 })).events;
      parts.push((await openStoredEvents(unit, events)).map((event) => event.data));
      return JSON.stringify(parts, (_key, member: unknown) =>
        typeof member === 'bigint' ? member.toString() : member,
      );
    });
  const adaKey = await inTenant((unit) => unit.keys.dataKey(ada, { create: false }));
  expect(adaKey).toBeDefined();
  const keyId = adaKey?.id ?? '';

  const markers = Object.values(marker);
  // Bea's own value on Ada's thread belongs to Bea and is kept; every other marker is Ada's.
  const erasedMarkers = markers.filter((value) => value !== marker.beaReply);
  // The counts of API usage sit in a buffer until the runtime writes them: write them, so the dump covers the table.
  expect(
    await flushUsage(runtime, queries),
    'kw_api_usage holds counts before the erasure',
  ).toBeGreaterThan(0);
  const before = await dumpAll(queries);
  // The controls: the values are in the dump as ciphertext, never as plaintext...
  expect(before).toContain('$kwe');
  expect(findPlaintext(before, markers)).toEqual([]);
  // ...the kernel reads each value that has a reader back through the subject's key...
  const readable = await readBack();
  for (const value of [
    marker.email,
    marker.notes,
    marker.topic,
    marker.beaReply,
    marker.adaReply,
  ]) {
    expect(readable, `${value} is readable before the erasure`).toContain(value);
  }
  // ...each marker of the other paths opens through the kernel's reader of that path...
  const recovered = await recoverMarkers(runtime, queries, adaThread);
  expect(recovered, 'every reader recovers its marker before the erasure').toEqual({
    // The subscribe job has run and left no input: it was read while queued, above.
    address: undefined,
    deadAddress: marker.deadAddress,
    timed: marker.timed,
    deliver: marker.deliver,
    tag: marker.tag,
    contact: marker.contact,
  });
  // ...and the subject's key seals a value in every table the inventory says holds one.
  const holding = (dump: string): string[] =>
    [...sectionsOf(dump)]
      .filter(([, rows]) => rows.includes(keyId))
      .map(([name]) => name.split('.')[1] ?? name);
  for (const table of ['kw_events', 'kw_stream_records', 'core__effect', 'kw_jobs']) {
    expect(holding(before), `${table} holds a value under the subject's key`).toContain(table);
  }
  expect(sectionsOf(before).size).toBeGreaterThan(0);
  // The new paths hold the subject too: a ticket, a parked stream, a refused effect, a dead reaction.
  const ticketsBefore = sectionsOf(before);
  expect(
    [...ticketsBefore].some(
      ([name, rows]) => name.endsWith('.live__stream_ticket') && rows.includes(adaSession),
    ),
    'a stream ticket of the subject exists before the erasure',
  ).toBe(true);
  const parkedBefore = await rowsOf(queries, 'kw_parked');
  expect(parkedBefore.length, 'a stream is parked before the erasure').toBeGreaterThan(0);
  // A dead job of the module's service principal holds the subject's id sealed under the subject's key.
  const deadKept = await expectDeadJobOpens(
    queries,
    { id: keyId, material: adaKey?.material ?? new Uint8Array() },
    ada,
  );
  const forbidden = [ada, adaSession, adaThread];
  await expectDeadlineJobHoldsEffectIdOnly(
    queries,
    [...forbidden, ...markers],
    'before the erasure',
  );
  await expectStrandedJobOpens(
    queries,
    { id: keyId, material: adaKey?.material ?? new Uint8Array() },
    marker.deadAddress,
  );

  // The control of the opener: with the subject's own key, the envelopes of the dump open to markers.
  const scopes: readonly StorageScope[] = [
    scope,
    { level: 'backend', backendId: runtime.backendId },
  ];
  const envelopesBefore = await envelopesIn(queries);
  const openBefore = await openedMarkers({
    runtime,
    envelopes: envelopesBefore,
    keys: [
      { label: 'the data key of the subject', material: adaKey?.material ?? new Uint8Array() },
    ],
    markers: erasedMarkers,
    scopes,
  });
  for (const value of [marker.email, marker.notes, marker.topic, marker.adaReply]) {
    expect(
      openBefore.some((line) => line.startsWith(`${value} `)),
      `${value} opens with the subject's key before the erasure`,
    ).toBe(true);
  }
  // The control of the tags and fingerprints: the dump holds them before the erasure.
  const emailTag = await emailTagOf(runtime, scope);
  expect(before, 'the eq tag of the email is in the dump before the erasure').toContain(emailTag);
  const fingerprints = new Map(
    [...planted].map(([name, { action, input }]) => [
      name,
      plainFingerprint(action, runtime.head, input),
    ]),
  );
  // No command keeps a plain fingerprint, before or after the erasure (WP-158): every receipt holds
  // the keyed `kwf1.` form, and a decision record holds `kwb1.` or `kwd1.`.
  const heldBefore = [...fingerprints].filter(([, hash]) => before.includes(hash)).map(([n]) => n);
  expect(heldBefore, 'no plain fingerprint of a command is in the dump, not even before').toEqual(
    [],
  );
  expect(before, 'the receipts hold the keyed form').toMatch(/kwf1\.[0-9a-f]{64}/);

  await operator.invoke(
    'core.eraseSubject',
    { subjectId: ada as never, reason: 'subjectRequest' },
    { prefer: 'async' },
  );
  await runtime.drainJobs();
  await worker.pass();
  await runtime.drainJobs();

  expect(
    await flushUsage(runtime, queries),
    'kw_api_usage holds counts after the erasure',
  ).toBeGreaterThan(0);
  const after = await dumpAll(queries);
  expect(findPlaintext(after, markers)).toEqual([]);
  // No marker of the subject is in the dump in any form: plain, JSON-escaped, base64, base64url, hex, base32.
  expect(formsFoundIn(after, erasedMarkers)).toEqual([]);
  // Nor the equality tag of the email, nor the plain fingerprint of a command, but the gaps below.
  expect(after).not.toContain(emailTag);
  const fingerprintsFound = new Map<string, readonly string[]>(
    [...fingerprints]
      .map(([name, hash]): [string, readonly string[]] => [
        name,
        [...sectionsOf(after)]
          .filter(([, rows]) => rows.includes(hash))
          .map(([table]) => table.split('.')[1] ?? table),
      ])
      .filter(([, tables]) => tables.length > 0),
  );
  // The key is gone: nothing sealed under it opens, wherever its ciphertext still is.
  expect(await inTenant((unit) => unit.keys.keyById(keyId))).toBeUndefined();
  const gone = await readBack();
  for (const value of [marker.email, marker.notes, marker.topic, marker.adaReply]) {
    expect(gone, `${value} is not readable after the erasure`).not.toContain(value);
  }
  // Every key that still exists, tried on every sealed value of the dump: only Bea's value opens.
  const keys = await keysLeft(runtime, queries, scope);
  expect(keys.map((key) => key.label)).not.toContain(`data key ${keyId} of the tenant scope`);
  const envelopes = await envelopesIn(queries);
  expect(envelopes.length, 'the dump still holds sealed values').toBeGreaterThan(0);
  const opened = await openedMarkers({ runtime, envelopes, keys, markers: erasedMarkers, scopes });
  expect(
    (await openedMarkers({ runtime, envelopes, keys, markers: [marker.beaReply], scopes })).length,
    "Bea's value stays readable with her key (the control of the opener after the erasure)",
  ).toBeGreaterThan(0);
  // The same readers recover nothing: the keys are gone or the records are purged.
  expect(await recoverMarkers(runtime, queries, adaThread)).toEqual({
    address: undefined,
    deadAddress: undefined,
    timed: undefined,
    deliver: undefined,
    tag: undefined,
    contact: undefined,
  });
  // Bea's own value on Ada's thread belongs to Bea and is kept; the owned thread is gone with its records.
  expect(await inTenant((unit) => unit.streams.read('probe.notes', adaThread, null, 100))).toEqual(
    [],
  );
  const records = [...sectionsOf(after)].filter(([name]) => name.endsWith('.kw_stream_records'));
  expect(records.length).toBeGreaterThan(0);
  for (const [, rows] of records) expect(rows).not.toContain(adaThread);

  // A parked stream keeps the kind and the code of its error and nothing else.
  const parked = await rowsOf(queries, 'kw_parked');
  expect(parked.length).toBeGreaterThan(0);
  for (const row of parked) {
    expect(Object.keys(row.last_error as object).sort()).toEqual(['code', 'kind']);
  }
  // The dead job stays (another principal's job is kept, D7), and its sealed subject opens with no key.
  await expectDeadJobUnreadable({
    queries,
    keyId,
    keys,
    subject: ada,
    markers: erasedMarkers,
    kept: deadKept,
  });
  // So does the operator's job that three lost leases ended dead, and the one that waits for its retry.
  await expectStrandedJobUnreadable({
    queries,
    keyId,
    keys,
    address: marker.deadAddress,
    markers: erasedMarkers,
  });
  await expectDeferJobKept(queries);
  // The effect of the subject was settled by the erasure, which cancelled its deadline job (WP-138).
  expect(
    (await rowsOf(queries, 'kw_jobs')).filter((row) =>
      String(row.key ?? '').startsWith('core.deadline:'),
    ),
    'the deadline job of the subject’s effect is gone after the erasure',
  ).toEqual([]);
  // The ticket of the subject's session is purged with the rest of its principal's rows.
  expect(
    [...sectionsOf(after)].filter(
      ([name, rows]) => name.endsWith('.live__stream_ticket') && rows.includes(adaSession),
    ),
  ).toEqual([]);

  // The personal values in derived data are gone (WP-130).
  expectDerivedDataGone({
    after,
    fingerprints,
    planted,
    erasedMarkers,
    fingerprintsFound,
    jobKey: gapMarker.jobKey,
    effectKey: gapMarker.effectKey,
    topic: marker.topic,
    envelopes,
  });

  // The gaps that are known are found, and nothing else of the kind is: with none open, no marker
  // opens with a key that exists, the output of an effect included (WP-138).
  const evidence = { opened, effectOutput: marker.effectOutput };
  const claimedOpen: string[] = [];
  for (const gap of knownGaps as readonly KnownGap[]) {
    const found = gap.found(evidence);
    expect(
      found,
      `${gap.name} (${gap.workPackage}) is found; when it is closed, remove its entry`,
    ).not.toEqual([]);
    claimedOpen.push(...found.filter((entry) => entry.includes(' opens through ')));
  }
  expect(opened, 'what opens with a key that exists is exactly what the known gaps name').toEqual(
    claimedOpen.sort(),
  );

  // Every table is named by the inventory or by an entity of the app.
  const entityTables = new Set(
    [...runtime.app.registry.entities.values()].map((entry) => entry.descriptor.table),
  );
  await expectEveryTableNamed(queries, entityTables);

  // The subject's id, and the ids of the rows it owns, are kept only where the inventory says so.
  await expectKeptReferences({ after, queries, entityTables, ids: [ada, adaThread, adaSession] });
}

export type { DumpCase };
export { runErasureDumpCase };
