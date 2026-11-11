import {
  type AppType,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineReaction,
  defineRule,
  defineStream,
  type EntityType,
  errors,
  field,
  type ModuleBaseType,
  type ModuleType,
  openStoredRecords,
  shape,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { findPlaintext } from '../../src/dump/find-plaintext.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';

const folderDef = defineEntity({
  prefix: 'saf',
  dataSubject: 'owner',
  fields: { owner: field.subject() },
});
interface Folder extends EntityType<typeof folderDef> {}
const folder: Folder = folderDef;

const crateDef = defineEntity({
  prefix: 'sac',
  dataSubject: 'owner',
  fields: { owner: field.subject() },
});
interface Crate extends EntityType<typeof crateDef> {}
const crate: Crate = crateDef;

const notesDef = defineStream({
  key: field.ref.own('folder'),
  record: shape({ text: field.string().personal(), n: field.integer() }),
  readAs: 'folder',
});

const shelfBaseDef = defineModuleBase({
  id: 'shelf',
  version: '0.1.0',
  entities: { folder, crate },
  streams: { notes: notesDef },
});
interface ShelfBase extends ModuleBaseType<typeof shelfBaseDef> {}
const shelfBase: ShelfBase = shelfBaseDef;

const file = defineCommand(shelfBase, {
  execution: 'async',
  input: shape({ text: field.string() }),
  output: shape({ folderId: field.ref.own('folder') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(folder);
    return {
      events: [
        ctx.write.shelf.folder.create({ id, owner: ctx.principal.subject }),
        ctx.write.shelf.notes.append(id, [{ text: input.text, n: 1 }]),
      ],
      result: { folderId: id },
    };
  },
});

// The appends are valid; an inline reaction to the crate then fails, after the appends were made.
const fileThenFail = defineCommand(shelfBase, {
  execution: 'async',
  input: shape({ text: field.string() }),
  output: shape({ folderId: field.ref.own('folder') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(folder);
    const crateId = yield* ctx.newId(crate);
    return {
      events: [
        ctx.write.shelf.folder.create({ id, owner: ctx.principal.subject }),
        ctx.write.shelf.notes.append(id, [{ text: input.text, n: 1 }]),
        ctx.write.shelf.crate.create({ id: crateId, owner: ctx.principal.subject }),
      ],
      result: { folderId: id },
    };
  },
});

const refuseCrate = defineReaction(shelfBase, {
  on: 'shelf.crate.created',
  timing: 'inline',
  react: () => {
    throw errors.validation('the crate is refused');
  },
});

const shelfDef = defineModule(shelfBase, {
  actions: { file, fileThenFail },
  policies: {
    crate: {
      writers: defineRule(shelfBase, crate, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
        reason: 'A signed-in user writes every crate.',
      }),
    },
    folder: {
      readers: defineRule(shelfBase, folder, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        reason: 'A signed-in user reads every folder.',
      }),
      writers: defineRule(shelfBase, folder, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
        reason: 'A signed-in user writes every folder.',
      }),
    },
    file: { signedIn: defineRule(shelfBase, file, { effect: 'allow', principal: 'user' }) },
    fileThenFail: {
      signedIn: defineRule(shelfBase, fileThenFail, { effect: 'allow', principal: 'user' }),
    },
  },
  reactions: { refuseCrate },
});
interface Shelf extends ModuleType<typeof shelfDef> {}
const shelf: Shelf = shelfDef;
const shelfAppDef = defineApp({ id: 'shelf', modules: [shelf] as const });
interface ShelfAppType extends AppType<typeof shelfAppDef> {}
const shelfApp: ShelfAppType = shelfAppDef;

const subject = '00000000-0000-4000-8000-000000000ada';
const secret = 'a line only the reader may see';
const dump = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    member instanceof Uint8Array
      ? Buffer.from(member).toString('hex')
      : typeof member === 'bigint'
        ? member.toString()
        : member,
  );

describe.each(['memory', 'pglite'] as const)('stream appends of an async command on %s', (kind) => {
  test('a worker appends the sealed records in the job unit; a failing attempt leaves none', {
    timeout: 30_000,
  }, async () => {
    const runtime = await startTestRuntime(shelfApp, {
      adapter: kind,
      workers: true,
      tenants: ['acme'],
    });
    const tenant = runtime.tenants.acme;
    const scope = { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id } as const;
    const ask = (action: string, commandId: string) =>
      runtime.invoker.invoke<unknown, { folderId: string }>({
        action,
        input: { text: secret },
        carrier: testCarrier(tenant, testPrincipal(subject)),
        requestId: crypto.randomUUID(),
        commandId,
        prefer: 'async',
        signal: new AbortController().signal,
      });
    const snapshot = (commandId: string) =>
      runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
        const all = await unit.events.readAll(null, { limit: 100, includeTransient: true });
        const folders = all.events
          .filter((event) => event.stream.type === 'shelf.folder')
          .map((event) => event.stream.id);
        const records = [];
        for (const id of folders)
          records.push(...(await unit.streams.read('shelf.notes', id, null, 10)));
        return { folders, records, receipt: await unit.receipts.get(commandId) };
      });

    const good = crypto.randomUUID();
    expect((await ask('shelf.file', good)).ok).toBe(true);
    expect(await runtime.drainJobs()).toBeGreaterThanOrEqual(1);
    const raw = await snapshot(good);
    const [folderId] = raw.folders;
    if (folderId === undefined) throw new Error('the worker wrote no folder');
    expect(raw.receipt?.status).toBe('completed');
    expect(raw.records).toHaveLength(1);
    expect(raw.records[0]?.data).toMatchObject({ text: { $kwe: 1 } });
    expect(findPlaintext(dump(raw), [secret])).toEqual([]);
    const opened = await runtime.sealed.unit(runtime.namespace, scope, async (unit) =>
      openStoredRecords(unit, {
        stream: 'shelf.notes',
        key: folderId,
        personal: ['text'],
        records: await unit.streams.read('shelf.notes', folderId, null, 10),
      }),
    );
    expect(opened.map((record) => record.data)).toEqual([{ text: secret, n: 1 }]);

    const bad = crypto.randomUUID();
    await ask('shelf.fileThenFail', bad);
    await runtime.drainJobs();
    const after = await snapshot(bad);
    expect(after.receipt?.status).not.toBe('completed');
    expect(after.folders).toEqual([folderId]);
    expect(after.records).toHaveLength(1);
    await runtime.stop();
  });
});
