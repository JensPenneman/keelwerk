import type { LiveFrame, StateToken } from '@keelwerk/core';
import {
  contracts,
  defineApp,
  defineCommand,
  defineEntity,
  defineFlag,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  field,
  mapItems,
  shape,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { expect, onTestFinished, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { setFlag } from './support/targeting-kit.ts';

const note = defineEntity({ prefix: 'note', fields: { text: field.string({ maxLength: 80 }) } });
const lensBase = defineModuleBase({
  id: 'lens',
  version: '0.1.0',
  requires: [contracts.live],
  entities: { note },
  flags: {
    wide: defineFlag({
      kind: 'boolean',
      default: false,
      level: 'tenant',
      purpose: 'release',
      expires: '2027-06-30',
    }),
  },
});
const record = defineCommand(lensBase, {
  input: shape({ text: field.string({ maxLength: 80 }) }),
  output: shape({ noteId: field.ref.own('note') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(note);
    return {
      events: [ctx.write.lens.note.create({ id, text: input.text })],
      result: { noteId: id },
    };
  },
});
const notes = defineSubscription(lensBase, {
  event: shape({ type: field.string(), noteId: field.string() }),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(ctx.live.entity('lens', 'note', { from: 'beginning', after: resume }), (change) => ({
      type: change.type,
      noteId: change.id,
    })),
});
const lens = defineModule(lensBase, {
  actions: { record, notes },
  policies: {
    record: { open: defineRule(lensBase, record, { effect: 'allow', principal: 'user' }) },
    notes: { open: defineRule(lensBase, notes, { effect: 'allow', principal: 'user' }) },
    note: {
      // The wide flag widens what a reader sees, so rows and the token check both depend on it.
      readers: defineRule(lensBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => (ctx.flags.lens?.wide === true ? {} : { text: 'public' }),
      }),
    },
  },
});
const app = defineApp({ id: 'lens-app', modules: [live, lens] });
const ada = testPrincipal('ada');

test('a subscription sees a flag targeted on for its tenant as an invoke does, and a token from a get resumes it without a resync', async () => {
  const runtime = await startTestRuntime(app, { operators: true, tenants: ['acme', 'globex'] });
  onTestFinished(() => runtime.stop());
  const { acme, globex } = runtime.tenants;
  const call = async <T>(tenant: typeof acme, action: string, input: unknown) => {
    const outcome = await runtime.invoker.invoke<unknown, T>({
      action,
      input,
      carrier: testCarrier(tenant, ada),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId: crypto.randomUUID(),
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
  // The writes warm the targeting cache before the flag exists, so it holds rows older than the flag.
  const inAcme = await call<{ noteId: string }>(acme, 'lens.record', { text: 'secret' });
  const inGlobex = await call<{ noteId: string }>(globex, 'lens.record', { text: 'secret' });
  const set = await setFlag(runtime, {
    key: 'lens.wide',
    targeting: {
      enabled: true,
      rules: [{ id: 'pilot', tenants: [acme.id], serve: { value: true } }],
      fallthrough: { value: false },
    },
    reason: 'pilot tenant',
  });
  expect(set).toMatchObject({ ok: true });
  // No time passes: only a snapshot that waits for fresh targeting sees the flag just set.

  /** Opens the watch, reads up to its head and the frames after it that are already there, then closes it. */
  const watch = async (tenant: typeof acme, after?: StateToken) => {
    const abort = new AbortController();
    const iterator = runtime.invoker
      .subscribe<unknown, unknown>(
        {
          action: 'lens.notes',
          input: {},
          carrier: testCarrier(tenant, ada),
          requestId: crypto.randomUUID(),
          signal: abort.signal,
        },
        after === undefined ? undefined : { after },
      )
      [Symbol.asyncIterator]();
    const frames: LiveFrame<unknown>[] = [];
    try {
      for (;;) {
        const step = await iterator.next();
        if (step.done === true) break;
        frames.push(step.value);
        if ('control' in step.value && step.value.control === 'head') break;
      }
    } finally {
      abort.abort();
      await iterator.return?.();
    }
    return frames;
  };
  const text = (frames: readonly LiveFrame<unknown>[]) => JSON.stringify(frames);

  // The subscription of the same tenant sees it the same way.
  expect(text(await watch(acme))).toContain(inAcme.noteId);
  expect(text(await watch(globex))).not.toContain(inGlobex.noteId);

  // The invoke sees the targeted flag: the secret note is readable in acme, and not in globex.
  const page = (tenant: typeof acme) =>
    call<{ items: readonly { id: string }[] }>(tenant, 'lens.note.query', {});
  expect((await page(acme)).items.map((item) => item.id)).toEqual([inAcme.noteId]);
  expect((await page(globex)).items).toEqual([]);

  // A token from a get is accepted by the watch while the targeting is in force: no resync.
  const { state } = await call<{ state: StateToken }>(acme, 'lens.note.get', { ids: [] });
  const resumed = await watch(acme, state);
  expect(resumed.some((frame) => 'control' in frame && frame.control === 'reset')).toBe(false);
  expect(resumed.some((frame) => 'control' in frame && frame.control === 'head')).toBe(true);
});
