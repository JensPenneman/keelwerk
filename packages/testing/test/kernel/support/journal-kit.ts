import type { Outcome } from '@keelwerk/core';
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
  field,
  type ModuleBaseType,
  type ModuleType,
  openStoredRecords,
  type StreamRecord,
  shape,
} from '@keelwerk/core';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import type { TestTenant } from '../../../src/harness/test-tenant.ts';

const pageDef = defineEntity({
  prefix: 'jpg',
  dataSubject: 'author',
  fields: {
    title: field.string({ maxLength: 100 }),
    author: field.subject(),
  },
});
interface Page extends EntityType<typeof pageDef> {}
const page: Page = pageDef;

const linesDef = defineStream({
  key: field.ref.own('page'),
  record: shape({ text: field.string().personal(), n: field.integer() }),
  readAs: 'page',
});

const journalBaseDef = defineModuleBase({
  id: 'journal',
  version: '0.1.0',
  entities: { page },
  streams: { lines: linesDef },
});
interface JournalBase extends ModuleBaseType<typeof journalBaseDef> {}
const journalBase: JournalBase = journalBaseDef;

const writePage = defineCommand(journalBase, {
  input: shape({ title: field.string({ maxLength: 100 }), texts: field.list(field.string()) }),
  output: shape({ pageId: field.ref.own('page') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(page);
    return {
      events: [
        ctx.write.journal.page.create({
          id,
          title: input.title,
          author: ctx.principal.subject,
        }),
        ctx.write.journal.lines.append(
          id,
          input.texts.map((text, index) => ({ text, n: index + 1 })),
        ),
      ],
      result: { pageId: id },
    };
  },
});

const append = defineCommand(journalBase, {
  input: shape({ pageId: field.ref.own('page'), text: field.string() }),
  output: shape({ ok: field.boolean() }),
  principal: 'user',
  decide: (input, ctx) => ({
    events: [ctx.write.journal.lines.append(input.pageId, [{ text: input.text, n: 100 }])],
    result: { ok: true },
  }),
});

const appendTwice = defineCommand(journalBase, {
  input: shape({ pageId: field.ref.own('page') }),
  output: shape({ ok: field.boolean() }),
  principal: 'user',
  decide: (input, ctx) => ({
    events: [
      ctx.write.journal.lines.append(input.pageId, [{ text: 'first', n: 1 }]),
      // A record without its `n`: the second draft is refused and the first rolls back.
      ctx.write.journal.lines.append(input.pageId, [{ text: 'second' } as never]),
    ],
    result: { ok: true },
  }),
});

const opened = defineReaction(journalBase, {
  on: 'journal.page.created',
  timing: 'inline',
  react: (event, ctx) => [
    ctx.write.journal.lines.append(event.state.id, [{ text: 'opened', n: 0 }]),
  ],
});

const lines = 'journal.lines';
/** The subject calls are made as: a UUID, because the subject column of a SQL adapter is one. */
const authorSubject = '00000000-0000-4000-8000-000000000ada';

const journalDef = defineModule(journalBase, {
  actions: { writePage, append, appendTwice },
  policies: {
    page: {
      readers: defineRule(journalBase, page, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        reason: 'A signed-in user reads every page.',
      }),
      writers: defineRule(journalBase, page, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
        reason: 'A signed-in user writes every page.',
      }),
    },
    writePage: {
      signedIn: defineRule(journalBase, writePage, { effect: 'allow', principal: 'user' }),
    },
    append: { signedIn: defineRule(journalBase, append, { effect: 'allow', principal: 'user' }) },
    appendTwice: {
      signedIn: defineRule(journalBase, appendTwice, { effect: 'allow', principal: 'user' }),
    },
  },
  reactions: { opened },
});
interface Journal extends ModuleType<typeof journalDef> {}
const journal: Journal = journalDef;

const journalAppDef = defineApp({ id: 'journal', modules: [journal] as const });
interface JournalAppType extends AppType<typeof journalAppDef> {}

/** The subject the journal calls are made as. */
export const author: string = authorSubject;

/** The journal app: pages and the stream `journal.lines` keyed by page, one personal member. */
export const journalApp: JournalAppType = journalAppDef;
export type JournalApp = JournalAppType;

/** A running journal runtime with one tenant and a call as a signed-in author. */
export interface JournalRuntime {
  readonly runtime: TestRuntime<JournalApp, 'acme'>;
  readonly tenant: TestTenant;
  call<T = unknown>(action: string, input: unknown, as?: string): Promise<Outcome<T>>;
}

/** Boots the journal app on a test runtime. */
export async function bootJournal(
  options: TestRuntimeOptions<'acme'> = {},
): Promise<JournalRuntime> {
  const runtime = await startTestRuntime(journalApp, { ...options, tenants: ['acme'] });
  const tenant = runtime.tenants.acme;
  return {
    runtime,
    tenant,
    call: <T>(action: string, input: unknown, as = authorSubject) =>
      runtime.invoker.invoke<unknown, T>({
        action,
        input,
        carrier: testCarrier(tenant, testPrincipal(as)),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      }),
  };
}

/**
 * The records of `journal.lines` for one page: as stored (`opened` false, through the raw adapter)
 * or as a handler reads them (`opened` true, through the sealing placement).
 */
export function readLines(
  runtime: TestRuntime<JournalApp, 'acme'>,
  tenant: TestTenant,
  pageId: string,
  opened: boolean,
): Promise<readonly StreamRecord[]> {
  const scope = { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id } as const;
  const adapter = opened ? runtime.sealed : runtime.adapter;
  return adapter.unit(runtime.namespace, scope, async (unit) => {
    const records = await unit.streams.read(lines, pageId, null, 100);
    return opened
      ? openStoredRecords(unit, { stream: lines, key: pageId, personal: ['text'], records })
      : records;
  });
}
