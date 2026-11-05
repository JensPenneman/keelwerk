import {
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineQuery,
  defineRule,
  field,
  pageOf,
  shape,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';

const note = defineEntity({
  prefix: 'note',
  fields: {
    owner: field.string().index(),
    title: field.string(),
    body: field.string().index().maskable(),
  },
});
const base = defineModuleBase({ id: 'notes', version: '0.1.0', entities: { note } });
const peek = defineQuery(base, note, {
  input: shape({}),
  output: pageOf(note),
  read: (_input, ctx) =>
    ctx.load.notes.note.query({ sort: [{ field: 'body', direction: 'asc' }], page: { first: 1 } }),
});
const notes = defineModule(base, {
  entityActions: { note: { peek } },
  policies: {
    note: {
      mine: defineRule(base, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => ({ owner: ctx.principal.subject }),
      }),
      titles: defineRule(base, note, {
        effect: 'allow',
        actions: ['peek'],
        principal: 'user',
        fields: [],
      }),
      writers: defineRule(base, note, { effect: 'allow', actions: ['write'], principal: 'user' }),
    },
  },
});
const app = defineApp({ id: 'notes-app', modules: [notes] });

async function boot() {
  const runtime = await startTestRuntime(app, { tenants: ['acme'] });
  const tenant = runtime.tenants.acme;
  const call = (
    who: ReturnType<typeof testPrincipal>,
    action: string,
    input: unknown,
    commandId = crypto.randomUUID(),
  ) =>
    runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action,
      input,
      carrier: testCarrier(tenant, who),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId,
    });
  return { runtime, call };
}

describe('a replay shows no more than the first answer did', () => {
  test('a caller outside the read plan gets the stored reference, whatever happens to the row', async () => {
    const { runtime, call } = await boot();
    const owner = testPrincipal('a');
    const writer = testPrincipal('w');
    const created = await call(owner, 'notes.note.create', {
      owner: 'a',
      title: 't',
      body: 'first secret body',
    });
    const id = (created as unknown as { value: { id: string } }).value.id;
    const command = crypto.randomUUID();
    const first = await call(writer, 'notes.note.update', { id, patch: { title: 'x' } }, command);
    expect(first).toMatchObject({ ok: true, value: { entity: 'notes.note', id } });
    const reference = (first as { value: unknown }).value;
    expect(JSON.stringify(reference)).not.toContain('secret');

    await call(owner, 'notes.note.update', { id, patch: { body: 'later secret body' } });
    const afterEdit = await call(
      writer,
      'notes.note.update',
      { id, patch: { title: 'x' } },
      command,
    );
    expect(afterEdit).toMatchObject({ ok: true, replayed: true, value: reference });

    await call(owner, 'notes.note.archive', { id });
    const afterArchive = await call(
      writer,
      'notes.note.update',
      { id, patch: { title: 'x' } },
      command,
    );
    expect(afterArchive).toMatchObject({ ok: true, replayed: true, value: reference });
    await runtime.stop();
  }, 60_000);

  test('a caller who may read the row gets it masked, as it is now', async () => {
    const { runtime, call } = await boot();
    const owner = testPrincipal('a');
    const created = await call(owner, 'notes.note.create', { owner: 'a', title: 't', body: 'b1' });
    const id = (created as unknown as { value: { id: string } }).value.id;
    const command = crypto.randomUUID();
    await call(owner, 'notes.note.update', { id, patch: { title: 'x' } }, command);
    await call(owner, 'notes.note.update', { id, patch: { title: 'y' } });
    expect(
      await call(owner, 'notes.note.update', { id, patch: { title: 'x' } }, command),
    ).toMatchObject({
      ok: true,
      replayed: true,
      value: { id, title: 'y', version: 3 },
    });
    await runtime.stop();
  }, 60_000);

  test('a page sorted by a field the caller may not read never carries its value in a cursor', async () => {
    const { runtime, call } = await boot();
    await call(testPrincipal('a'), 'notes.note.create', {
      owner: 'a',
      title: 't',
      body: 'aaa secret body of a',
    });
    const peeked = await call(testPrincipal('w'), 'notes.note.peek', {});
    // Tests fail such a sort; production strips the cursors (the shape stage covers both).
    expect(peeked).toMatchObject({ ok: false, error: { kind: 'internal' } });
    expect(JSON.stringify(peeked)).not.toContain('secret');
    await runtime.stop();
  }, 60_000);
});
