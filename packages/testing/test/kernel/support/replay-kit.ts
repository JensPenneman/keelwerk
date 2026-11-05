import {
  type AppType,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  type EntityType,
  field,
  type ModuleBaseType,
  type ModuleType,
  parseToken,
  shape,
} from '@keelwerk/core';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';

const saltBytes = 16;
const tokenPrefix = 'keepx';

const vaultDef = defineEntity({
  prefix: 'vlt',
  fields: { verifier: field.verifier(), uses: field.integer().optional() },
});
interface Vault extends EntityType<typeof vaultDef> {}
const vault: Vault = vaultDef;

const ticketDef = defineEntity({
  prefix: 'tkt',
  fields: {
    publicId: field.string().unique(),
    tokenVerifier: field.verifier(),
    usedAt: field.instant().optional(),
  },
  history: 'state',
  reason: 'A ticket is issued once and redeemed once; nothing else needs its history.',
});
interface Ticket extends EntityType<typeof ticketDef> {}
const ticket: Ticket = ticketDef;

const keepBaseDef = defineModuleBase({ id: 'keep', version: '0.1.0', entities: { vault, ticket } });
interface KeepBase extends ModuleBaseType<typeof keepBaseDef> {}
const keepBase: KeepBase = keepBaseDef;

const enrol = defineCommand(keepBase, {
  input: shape({ password: field.secret() }),
  output: shape({ id: field.string() }),
  auth: { public: true },
  execution: 'sync',
  *decide(input, ctx) {
    const id = yield* ctx.newId(vault);
    const verifier = yield* ctx.compute.argon2idHash(input.password, yield* ctx.random(saltBytes));
    return { events: [ctx.write.keep.vault.create({ id, verifier })], result: { id } };
  },
});

const use = defineCommand(keepBase, {
  input: shape({ id: field.ref.own('vault'), password: field.secret() }),
  output: shape({ uses: field.integer() }),
  auth: { public: true },
  execution: 'sync',
  *decide(input, ctx) {
    const row = yield* ctx.load.keep.vault.byId(input.id);
    const ok = yield* ctx.compute.argon2idVerify(row?.verifier ?? '', input.password);
    if (row === undefined || !ok) throw new Error('the password does not match');
    const uses = (row.uses ?? 0) + 1;
    return { events: [ctx.write.keep.vault.update(row, { uses })], result: { uses } };
  },
});

const rotate = defineCommand(keepBase, {
  input: shape({ id: field.ref.own('vault'), password: field.secret(), next: field.secret() }),
  output: shape({}),
  auth: { public: true },
  execution: 'sync',
  *decide(input, ctx) {
    const row = yield* ctx.load.keep.vault.byId(input.id);
    const ok = yield* ctx.compute.argon2idVerify(row?.verifier ?? '', input.password);
    if (row === undefined || !ok) throw new Error('the password does not match');
    const verifier = yield* ctx.compute.argon2idHash(input.next, yield* ctx.random(saltBytes));
    return { events: [ctx.write.keep.vault.update(row, { verifier })], result: {} };
  },
});

const issue = defineCommand(keepBase, {
  input: shape({}),
  output: shape({ id: field.string(), token: field.string() }),
  shownOnce: ['token'],
  auth: { public: true },
  execution: 'sync',
  *decide(_input, ctx) {
    const id = yield* ctx.newId(ticket);
    const issued = yield* ctx.secrets.issue({ prefix: tokenPrefix });
    return {
      events: [
        ctx.write.keep.ticket.create({
          id,
          publicId: issued.publicId,
          tokenVerifier: issued.verifier,
        }),
      ],
      result: { id, token: issued.plain },
    };
  },
});

const redeem = defineCommand(keepBase, {
  input: shape({ token: field.secret() }),
  output: shape({ id: field.string() }),
  auth: { public: true },
  execution: 'sync',
  *decide(input, ctx) {
    const parsed = parseToken(input.token);
    if (parsed === undefined) throw new Error('not a token');
    const row = yield* ctx.load.keep.ticket.one({ where: { publicId: parsed.publicId } });
    const ok =
      row === undefined ? false : yield* ctx.secrets.verify(input.token, row.tokenVerifier);
    if (row === undefined || !ok || row.usedAt !== undefined) throw new Error('not redeemable');
    return {
      events: [ctx.write.keep.ticket.update(row, { usedAt: ctx.clock.now() })],
      result: { id: row.id },
    };
  },
});

const keepDef = defineModule(keepBase, { actions: { enrol, use, rotate, issue, redeem } });
interface Keep extends ModuleType<typeof keepDef> {}
const keep: Keep = keepDef;

const keepAppDef = defineApp({ id: 'keep-app', modules: [keep] as const });
interface KeepApp extends AppType<typeof keepAppDef> {}

/** An app of two entities holding verifiers: a vault on a chain, and a ticket whose history is state. */
export const keepApp: KeepApp = keepAppDef;

/** A clock a test moves forward. */
export interface MovableClock {
  now(): Temporal.Instant;
  /** Moves it forward by whole hours. */
  advance(hours: number): void;
}

export function movableClock(): MovableClock {
  let offset = 0;
  return {
    now: () => Temporal.Now.instant().add({ hours: offset }),
    advance: (hours) => {
      offset += hours;
    },
  };
}

/** The keep app booted on a storage with one tenant, and a way to call its actions with chosen command ids. */
export interface BootedKeep {
  readonly runtime: TestRuntime<KeepApp>;
  readonly clock: MovableClock;
  call<T = unknown>(
    action: string,
    input: unknown,
  ): Promise<{ readonly commandId: string; readonly value: T }>;
}

export async function bootKeep(kind: 'memory' | 'pglite'): Promise<BootedKeep> {
  const clock = movableClock();
  const runtime = await startTestRuntime(keepApp, { adapter: kind, tenants: ['acme'], clock });
  const tenant = runtime.tenants.acme;
  return {
    runtime,
    clock,
    call: async (action, input) => {
      const commandId = crypto.randomUUID();
      const done = await runtime.invoker.invoke({
        action,
        input,
        carrier: { transport: 'test', headers: { 'x-tenant': tenant.id } },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        commandId,
      });
      if (!done.ok) throw done.error;
      return { commandId, value: done.value as never };
    },
  };
}
