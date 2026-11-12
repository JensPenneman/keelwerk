import type { AppType, EntityType, ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  contracts,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { live } from '@keelwerk/live';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';

const entryDef = defineEntity({
  prefix: 'ent',
  dataSubject: 'ownerId',
  fields: {
    title: field.string({ maxLength: 100 }),
    ownerId: field.subject().index(),
    secret: field.string().optional().personal(),
    authorId: field.subject().optional(),
    remark: field.string().optional().personal({ subject: 'authorId' }),
  },
  generated: { history: true, watch: true },
});
interface Entry extends EntityType<typeof entryDef> {}
const entry: Entry = entryDef;

const notebookBaseDef = defineModuleBase({
  id: 'notebook',
  version: '0.1.0',
  generates: ['watch'],
  requires: [contracts.live],
  entities: { entry },
});
interface NotebookBase extends ModuleBaseType<typeof notebookBaseDef> {}
const notebookBase: NotebookBase = notebookBaseDef;

const enter = defineCommand(notebookBase, {
  input: shape({ ownerId: field.subject(), title: field.string(), secret: field.string() }),
  output: shape({ entryId: field.ref.own('entry') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(entry);
    return {
      events: [
        ctx.write.notebook.entry.create({
          id,
          ownerId: input.ownerId,
          title: input.title,
          secret: input.secret,
        }),
      ],
      result: { entryId: id },
    };
  },
});

const annotate = defineCommand(notebookBase, {
  input: shape({
    entryId: field.ref.own('entry'),
    authorId: field.subject(),
    remark: field.string(),
  }),
  principal: 'operator',
  *decide(input, ctx) {
    const row = yield* ctx.load.notebook.entry.one({ where: { id: input.entryId } });
    if (row === undefined) return [];
    return [
      ctx.write.notebook.entry.update(row, { authorId: input.authorId, remark: input.remark }),
    ];
  },
});

const notebookDef = defineModule(notebookBase, {
  actions: { enter, annotate },
  policies: {
    enter: {
      operators: defineRule(notebookBase, enter, { effect: 'allow', principal: 'operator' }),
    },
    annotate: {
      operators: defineRule(notebookBase, annotate, { effect: 'allow', principal: 'operator' }),
    },
    entry: {
      readers: defineRule(notebookBase, entry, {
        effect: 'allow',
        actions: ['read'],
        principal: ['user', 'operator'],
        reason: 'Everyone reads the entries.',
      }),
    },
  },
});
interface Notebook extends ModuleType<typeof notebookDef> {}
const notebook: Notebook = notebookDef;

const appDef = defineApp({ id: 'erasure-live', modules: [live, notebook] as const });
interface LiveApp extends AppType<typeof appDef> {}
const liveApp: LiveApp = appDef;

let current: TestRuntime<typeof liveApp> | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

describe('what a subscriber and a reader of history see when a subject is erased (15.4.2, 14.7.5)', () => {
  test('the owner row ends with removed erased, the other row is told as changed and history is redacted', {
    timeout: 60_000,
  }, async () => {
    const worker = erasure({ pollMs: 3_600_000 });
    const runtime = await startTestRuntime(liveApp, {
      adapter: 'pglite',
      operators: true,
      workers: true,
      eventWorkers: [worker],
    });
    current = runtime;
    const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
    const idOf = (answer: unknown, key: string): string =>
      String((answer as Record<string, unknown>)[key]);
    const ada = crypto.randomUUID();
    const bea = crypto.randomUUID();
    const adaEntry = idOf(
      await operator.invoke('notebook.enter', {
        ownerId: ada as never,
        title: 'a',
        secret: 'live marker ada secret',
      }),
      'entryId',
    );
    const beaEntry = idOf(
      await operator.invoke('notebook.enter', {
        ownerId: bea as never,
        title: 'b',
        secret: 'live marker bea secret',
      }),
      'entryId',
    );
    await operator.invoke('notebook.annotate', {
      entryId: beaEntry as never,
      authorId: ada as never,
      remark: 'live marker ada remark',
    });

    // A subscriber who follows every row, archived ones included, from the beginning.
    const tenant = runtime.tenants.acme;
    if (tenant === undefined) throw new Error('no acme');
    const frames: unknown[] = [];
    const abort = new AbortController();
    const iterator = runtime.invoker
      .subscribe<unknown, Record<string, unknown>>({
        action: 'notebook.entry.watch',
        input: { includeArchived: true, from: 'beginning' },
        carrier: testCarrier(tenant, testPrincipal('watcher')),
        requestId: crypto.randomUUID(),
        signal: abort.signal,
      })
      [Symbol.asyncIterator]();
    const pump = (async () => {
      try {
        for (;;) {
          const step = await iterator.next();
          if (step.done === true) return;
          frames.push(step.value);
        }
      } catch {
        // The stream ends when the test aborts it.
      }
    })();
    const waitFor = async (test: () => boolean): Promise<void> => {
      const until = Date.now() + 15_000;
      while (!test()) {
        if (Date.now() > until) {
          throw new Error(
            `timed out; frames: ${JSON.stringify(frames, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    const text = () =>
      JSON.stringify(frames, (_key, member: unknown) =>
        typeof member === 'bigint' ? member.toString() : member,
      );
    await waitFor(() => text().includes(beaEntry) && text().includes(adaEntry));
    // What the subscriber was told before the erasure may hold the values; what follows must not.
    const before = frames.length;
    expect(text()).toContain('live marker ada remark');

    await operator.invoke(
      'core.eraseSubject',
      { subjectId: ada as never, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    await worker.pass();
    await waitFor(() => text().includes('"removed"'));
    await abort.abort();
    await iterator.return?.();
    await pump;

    const events = frames
      .map((frame) => (frame as { event?: Record<string, unknown> }).event)
      .filter((event): event is Record<string, unknown> => event !== undefined);
    // The erased owner's entry ends with `removed`, reason erased.
    const removed = events.filter((event) => event.type === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ id: adaEntry, reason: 'erased' });
    // The other subject's entry is told as a changed row without the erased subject's remark.
    const later = events.filter((event) => event.type === 'changed' && event.id === beaEntry);
    expect(later.length).toBeGreaterThan(0);
    expect(JSON.stringify(later.at(-1))).not.toContain('live marker ada remark');
    const told = JSON.stringify(frames.slice(before), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(told).not.toContain('live marker ada secret');
    expect(told).not.toContain('live marker ada remark');

    // History of the erased row stays readable, with the erased values as `{ redacted: true }`.
    const history = await operator.invoke('notebook.entry.history', { id: adaEntry as never });
    expect(JSON.stringify(history)).toContain('"redacted":true');
    expect(JSON.stringify(history)).not.toContain('live marker ada secret');
  });
});
