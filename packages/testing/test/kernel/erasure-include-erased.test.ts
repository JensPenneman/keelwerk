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
  renderTypeId,
  shape,
} from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { live } from '@keelwerk/live';
import { httpHost } from '@keelwerk/transport-http';
import { afterEach, describe, expect, test } from 'vitest';
import { readEventStream } from '../../src/conformance/transport/read-event-stream.ts';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipalHeader } from '../../src/harness/test-principal-header.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';

const noteDef = defineEntity({
  prefix: 'nte',
  dataSubject: 'ownerId',
  fields: {
    title: field.string({ maxLength: 100 }),
    ownerId: field.subject().index(),
    secret: field.string().optional().personal(),
  },
  generated: { history: true, watch: true },
});
interface Note extends EntityType<typeof noteDef> {}
const note: Note = noteDef;

const shelfBaseDef = defineModuleBase({
  id: 'shelf',
  version: '0.1.0',
  generates: ['watch'],
  requires: [contracts.live],
  entities: { note },
});
interface ShelfBase extends ModuleBaseType<typeof shelfBaseDef> {}
const shelfBase: ShelfBase = shelfBaseDef;

const put = defineCommand(shelfBase, {
  input: shape({ ownerId: field.subject(), title: field.string(), secret: field.string() }),
  output: shape({ noteId: field.ref.own('note') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(note);
    return {
      events: [
        ctx.write.shelf.note.create({
          id,
          ownerId: input.ownerId,
          title: input.title,
          secret: input.secret,
        }),
      ],
      result: { noteId: id },
    };
  },
});

const shelfDef = defineModule(shelfBase, {
  actions: { put },
  policies: {
    put: { operators: defineRule(shelfBase, put, { effect: 'allow', principal: 'operator' }) },
    note: {
      readers: defineRule(shelfBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: ['user', 'operator'],
        reason: 'Everyone reads the notes.',
      }),
    },
  },
});
interface Shelf extends ModuleType<typeof shelfDef> {}
const shelf: Shelf = shelfDef;

const shelfAppDef = defineApp({ id: 'erasure-include-erased', modules: [live, shelf] as const });
interface ShelfApp extends AppType<typeof shelfAppDef> {}
const shelfApp: ShelfApp = shelfAppDef;

let current: TestRuntime<typeof shelfApp> | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

const erasedTitle = 'forged erased marker title';
const keptTitle = 'forged kept marker title';

describe('includeErased is for the kernel only (14.7.2, RowQuery.includeErased)', () => {
  test('a request that forges the member through the HTTP surface still never sees the erased row', {
    timeout: 120_000,
  }, async () => {
    const worker = erasure({ pollMs: 3_600_000 });
    const runtime = await startTestRuntime(shelfApp, {
      adapter: 'memory',
      host: httpHost(),
      operators: true,
      workers: true,
      eventWorkers: [worker],
    });
    current = runtime;
    const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
    const ada = crypto.randomUUID();
    const bea = crypto.randomUUID();
    const idOf = (answer: unknown): string => String((answer as { noteId: string }).noteId);
    const erased = idOf(
      await operator.invoke('shelf.put', {
        ownerId: ada as never,
        title: erasedTitle,
        secret: 'forged erased secret',
      }),
    );
    const kept = idOf(
      await operator.invoke('shelf.put', {
        ownerId: bea as never,
        title: keptTitle,
        secret: 'forged kept secret',
      }),
    );
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: ada as never, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    await worker.pass();

    // The control: the kernel itself reads the tombstone with the member, and it still names the title.
    const descriptor = runtime.app.registry.entities.get('shelf.note')?.descriptor;
    if (descriptor === undefined) throw new Error('no shelf.note');
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const tombstone = await runtime.sealed.unit(runtime.namespace, scope, (unit) =>
      unit.rows.findOne(descriptor, {
        where: { op: 'eq', field: 'id', value: erased },
        includeArchived: true,
        includeErased: true,
      }),
    );
    expect(tombstone?.title).toBe(erasedTitle);
    expect(tombstone?.kwErasedAt).toBeDefined();

    const headers = {
      'content-type': 'application/json',
      'x-tenant': runtime.tenants.acme.id,
      [testPrincipalHeader]: JSON.stringify({ subject: 'reader', roles: [], claims: {} }),
    };
    const url = 'https://forged.example.test';
    const invoke = async (action: string, input: Record<string, unknown>): Promise<string> => {
      const response = await runtime.fetch(
        new Request(`${url}/_keelwerk/v1/invoke`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action, input }),
        }),
      );
      return response.text();
    };
    const real = { includeArchived: true };
    const ids = [renderTypeId('nte', erased), renderTypeId('nte', kept)];
    const refused = (text: string) => {
      const answer = JSON.parse(text) as {
        ok: boolean;
        error?: { kind: string; issues?: { path: unknown[]; message: string }[] };
      };
      expect(answer.ok).toBe(false);
      expect(answer.error?.kind).toBe('validation');
      expect(answer.error?.issues).toContainEqual({
        path: ['includeErased'],
        message: 'is not a field of this shape',
      });
    };

    // The controls: the real flag answers the kept row, and the erased row is invisible even so.
    const control = await invoke('shelf.note.get', { ids, ...real });
    expect(control).toContain(keptTitle);
    expect(control).not.toContain(erasedTitle);
    expect(JSON.parse(control)).toMatchObject({
      ok: true,
      value: { list: [{ title: keptTitle }], notFound: [ids[0]] },
    });
    expect(await invoke('shelf.note.query', { ...real })).toContain(keptTitle);

    // The forged member is refused as an unknown member of the input, whichever action carries it.
    refused(await invoke('shelf.note.get', { ids, includeErased: true, ...real }));
    refused(await invoke('shelf.note.query', { includeErased: true, ...real }));
    refused(
      await invoke('shelf.note.query', { filter: { ownerId: { eq: ada } }, includeErased: true }),
    );
    refused(await invoke('shelf.note.queryChanges', { since: 'beginning', includeErased: true }));

    // A watch that forges the member is refused the same way, and one that does not never tells of the row.
    const watch = async (input: Record<string, unknown>): Promise<string> => {
      const abort = new AbortController();
      const response = await runtime.fetch(
        new Request(
          `${url}/_keelwerk/v1/subscribe?action=shelf.note.watch&input=${encodeURIComponent(
            JSON.stringify(input),
          )}`,
          { headers, signal: abort.signal },
        ),
      );
      const stream = readEventStream(response);
      const frames: string[] = [];
      try {
        for (let seen = 0; seen < 6; seen += 1) {
          const frame = await stream.next(2_000).catch(() => undefined);
          if (frame === undefined) break;
          frames.push(JSON.stringify(frame));
          if (frame.event === 'head') break;
        }
      } finally {
        abort.abort();
        await stream.close();
      }
      return `${String(stream.response.status)} ${frames.join('\n')}`;
    };
    const forgedWatch = await watch({ from: 'beginning', includeErased: true, ...real });
    expect(forgedWatch).not.toContain(erasedTitle);
    expect(forgedWatch).not.toContain(keptTitle);
    const plainWatch = await watch({ from: 'beginning', ...real });
    expect(plainWatch).toContain(keptTitle);
    expect(plainWatch).not.toContain(erasedTitle);

    // The history of an erased row is readable by design (D12) and redacted: the kernel sets the member
    // itself there, and a client that sends it is refused like any other.
    const history = await invoke('shelf.note.history', { id: ids[0] });
    expect(JSON.parse(history)).toMatchObject({ ok: true });
    expect(history).toContain('"redacted":true');
    expect(history).not.toContain('forged erased secret');
    refused(await invoke('shelf.note.history', { id: ids[0], includeErased: true }));
  });
});
