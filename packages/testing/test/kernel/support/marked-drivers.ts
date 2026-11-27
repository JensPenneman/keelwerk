import { defineApp } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import { pgliteQuery } from './dump-sections.ts';
import { dumpAll } from './erasure-dump-tools.ts';
import { formsFoundIn } from './erasure-forms.ts';
import { type Combo, markerOf, memberOf, type Site } from './marked-grid.ts';
import { type Readable, readViews, settledFindings, type View } from './marked-readers.ts';
import { feed, otherAt, personalAt, skeletonModule } from './marked-skeleton.ts';

type Loose = (...args: never[]) => Promise<never>;
interface Runtime extends Readable {
  readonly adapter: never;
  readonly control: { readonly adapter: never };
  readonly invoker: { invoke: Loose };
  readonly drainJobs: () => Promise<number>;
  readonly stop: () => Promise<void>;
}

const subjects = ['A', 'B'] as const;
type Who = (typeof subjects)[number];
/** The subject of the dry runs: its values are fresh, so no unique value collides with a stored row. */
const fresh = 'C';
const subjectIds: Record<string, string> = {};
/** The instant every clock of a run reads: nothing a run does depends on how long it takes. */
const instant = Temporal.Instant.from('2026-03-01T12:00:00Z');

/** The values of every member of a site for one subject, each carrying its own marker. */
function valuesOf(site: Site, combos: readonly Combo[], who: string): Record<string, unknown> {
  return Object.fromEntries(
    combos.map((c) => [c.name, c.placement.value(markerOf(site, c.name, who))]),
  );
}

/** The markers of the members of `combos` for one subject. */
const markersOf = (site: Site, combos: readonly Combo[], who: string) =>
  combos.map((c) => markerOf(site, c.name, who));

/** The command a site stores its value through a second time, and what it is invoked with. */
const second: Readonly<Record<string, readonly string[]>> = {
  commandInput: ['mp.run'],
  commandOutput: ['mp.out'],
  effectInput: ['mp.ask', 'mp.check'],
  effectOutput: ['mp.ask'],
  domainEvent: ['mp.holder.note'],
  processEvent: ['mp.holder.note'],
};
const asyncJobs = new Set(['mp.run']);
/** The copies each place claims: an explain answer that is ok, for each of these commands (an async command has no dry run). */
const copiesOf: Readonly<Record<string, readonly (readonly [string, 'dry-run' | 'redecide'])[]>> = {
  entity: [
    ['mp.enrol', 'dry-run'],
    ['mp.enrol', 'redecide'],
  ],
  streamRecord: [
    ['mp.enrol', 'dry-run'],
    ['mp.enrol', 'redecide'],
  ],
  domainEvent: [
    ['mp.holder.note', 'dry-run'],
    ['mp.holder.note', 'redecide'],
  ],
  processEvent: [
    ['mp.holder.note', 'dry-run'],
    ['mp.holder.note', 'redecide'],
  ],
  commandOutput: [
    ['mp.out', 'dry-run'],
    ['mp.out', 'redecide'],
  ],
  effectInput: [
    ['mp.ask', 'dry-run'],
    ['mp.ask', 'redecide'],
    ['mp.check', 'dry-run'],
  ],
  effectOutput: [
    ['mp.ask', 'dry-run'],
    ['mp.ask', 'redecide'],
  ],
};
const ownSubject = ['commandInput', 'effectInput', 'effectOutput'];

/** What one site's run found wrong, one sentence each; empty when every accepted combination is protected. */
async function protectionFindings(site: Site, combos: readonly Combo[]): Promise<string[]> {
  const found: string[] = [];
  const members = Object.fromEntries(
    combos.map((c) => [c.name, memberOf(c, personalAt(site), otherAt(site))]),
  );
  const app = defineApp({ id: 'mp-app', modules: [skeletonModule(site, members)] as never });
  const worker = erasure({ pollMs: 3_600_000 });
  const dispatcher = consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });
  const runtime = (await startTestRuntime(
    app as never,
    {
      adapter: 'pglite',
      operators: true,
      workers: true,
      clock: { now: () => instant },
      eventWorkers: [dispatcher, worker],
      ...(site === 'configuration' ? { config: { mp: valuesOf(site, combos, 'A') } } : {}),
    } as never,
  )) as never as Runtime;
  try {
    const operator = createLocalClient(runtime as never, {
      principal: testOperator(),
      tenant: 'acme',
    }) as never as {
      invoke: (a: string, i: unknown, o?: object) => Promise<{ id?: string }>;
    };
    const queries = [pgliteQuery(runtime.adapter), pgliteQuery(runtime.control.adapter)];
    const produced = new Set<string>();
    const explain = async (
      input: { mode: string; ref?: string; input?: unknown; commandId?: string },
      action: string,
      who: string,
    ) => {
      const answer = await (
        runtime.invoker.invoke as never as (r: object) => Promise<{ ok: boolean; value?: unknown }>
      )({
        action: 'core.explain',
        input: { backend: runtime.backendId, tenant: runtime.tenants.acme.id, ...input },
        carrier: {
          transport: 'cli',
          headers: { 'x-tenant': runtime.tenants.acme.id },
          local: { inProcess: true },
        },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
      if (answer.ok) produced.add(`${input.mode} ${action} ${who}`);
      return JSON.stringify(answer.ok ? answer.value : answer, (_k, v: unknown) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
    };
    const settle = async () => {
      for (let round = 0; round < 3; round += 1) {
        await dispatcher.settled();
        await runtime.drainJobs();
      }
    };
    const shown: string[] = [];
    feed.continued = 0;
    const committed: { who: Who; action: string; input: unknown; commandId: string }[] = [];
    // Store the values of both subjects through the site.
    for (const who of site === 'configuration' ? [] : subjects) {
      feed.values = valuesOf(site, combos, who);
      const enrolId = crypto.randomUUID();
      const made = await operator.invoke('mp.enrol', {}, { commandId: enrolId });
      committed.push({ who, action: 'mp.enrol', input: {}, commandId: enrolId });
      subjectIds[who] = ownSubject.includes(site) ? crypto.randomUUID() : String(made.id);
      for (const action of second[site] ?? []) {
        const input = asyncJobs.has(action)
          ? { owner: subjectIds[who], ...feed.values }
          : action === 'mp.holder.note'
            ? { id: made.id }
            : action === 'mp.out'
              ? {}
              : { owner: subjectIds[who] };
        const commandId = crypto.randomUUID();
        await operator.invoke(action, input, {
          commandId,
          ...(asyncJobs.has(action) ? { prefer: 'async' } : {}),
        });
        committed.push({ who, action, input, commandId });
      }
      await settle();
    }
    // Shown copies: a dry run and a re-decide of each command (a dry run that stops at an inline perform included).
    for (const { who, action, input, commandId } of committed) {
      feed.values = valuesOf(site, combos, fresh);
      shown.push(await explain({ mode: 'dry-run', ref: action, input }, action, who));
      feed.values = valuesOf(site, combos, who);
      if (site !== 'commandInput')
        shown.push(await explain({ mode: 'redecide', commandId, input }, action, who));
    }
    // A copy a place claims must have been produced: an answer that is ok, not a conflict or a refusal.
    for (const [action, mode] of copiesOf[site] ?? []) {
      for (const who of subjects) {
        if (!produced.has(`${mode} ${action} ${who}`))
          found.push(`copy not produced: ${mode} of ${action} (${who})`);
      }
    }
    found.push(...(await settledFindings(runtime, site, subjects.length)));
    const all = [...subjects, fresh].flatMap((who) => markersOf(site, combos, who));
    const inClear = (text: string, what: string) => {
      for (const hit of formsFoundIn(text, all)) found.push(`${what}: ${hit}`);
    };
    inClear(await dumpAll(queries), 'stored');
    inClear(shown.join('\n'), 'shown');
    const personal = combos.filter((c) => c.kind === 'personal');
    if (personal.length > 0) {
      const names = personal.map((c) => c.name);
      const readBack = () => readViews(runtime, site, queries, names);
      const byName = (view: View) => personal.filter((c) => view.members.includes(c.name));
      const before = await readBack();
      if (site === 'commandInput') {
        // The queued job is there to read; the ended one is judged too if anything of it is left.
        for (const name of names) {
          if (!before.some((view) => view.label === `mp.run ${name}`))
            found.push(`no queued job holds ${name}`);
        }
      }
      for (const view of before) {
        for (const who of subjects) {
          for (const marker of markersOf(site, byName(view), who)) {
            if (!view.text.includes(marker))
              found.push(`kernel read before erasure (${view.label}): ${marker} did not open`);
          }
        }
      }
      await operator.invoke(
        'core.eraseSubject',
        { subjectId: subjectIds.A, reason: 'subjectRequest' },
        { prefer: 'async' },
      );
      await settle();
      await worker.pass();
      await settle();
      for (const view of await readBack()) {
        for (const marker of markersOf(site, byName(view), 'A')) {
          if (view.text.includes(marker))
            found.push(`after erasure (${view.label}): ${marker} still opens`);
        }
        for (const marker of markersOf(site, byName(view), 'B')) {
          if (!view.text.includes(marker))
            found.push(`after erasure of A (${view.label}): ${marker} of B no longer opens`);
        }
      }
      inClear(await dumpAll(queries), 'stored after erasure');
    }
  } finally {
    await runtime.stop();
  }
  return found;
}

export { protectionFindings };
