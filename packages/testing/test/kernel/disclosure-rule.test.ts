import {
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
} from '@keelwerk/core';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';

const note = defineEntity({
  prefix: 'note',
  fields: { owner: field.string().index(), level: field.integer().index() },
});
const base = defineModuleBase({ id: 'notes', version: '0.1.0', entities: { note } });
const notes = defineModule(base, {
  policies: {
    note: {
      mine: defineRule(base, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) =>
          ctx.principal.claims.useMine === true ? { owner: ctx.principal.subject } : false,
      }),
      open: defineRule(base, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => ({ level: { lte: Number(ctx.principal.claims.threshold ?? -1) } }),
      }),
      // The seeding subject reads what it writes (a command's output passes the read plan, 8.4);
      // the sealed level does not cover it, so the readers below are what the model tests.
      seed: defineRule(base, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => (ctx.principal.claims.seed === true ? {} : false),
      }),
      locked: defineRule(base, note, {
        effect: 'deny',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => (ctx.principal.claims.seed === true ? false : { level: 9 }),
        reason: 'Level 9 is sealed.',
      }),
      writers: defineRule(base, note, { effect: 'allow', actions: ['write'], principal: 'user' }),
    },
  },
});
const app = defineApp({ id: 'notes-app', modules: [notes] });

interface Snapshot {
  readonly rows: ReadonlyMap<string, { owner: string; level: number; archived: boolean }>;
}

type Op =
  | { kind: 'create'; owner: string; level: number }
  | { kind: 'update'; at: number; owner: string; level: number }
  | { kind: 'archive'; at: number }
  | { kind: 'restore'; at: number };

const owners = fc.constantFrom('a', 'b', 'c');
const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('create' as const),
    owner: owners,
    level: fc.integer({ min: 0, max: 9 }),
  }),
  fc.record({
    kind: fc.constant('update' as const),
    at: fc.nat(20),
    owner: owners,
    level: fc.integer({ min: 0, max: 9 }),
  }),
  fc.record({ kind: fc.constant('archive' as const), at: fc.nat(20) }),
  fc.record({ kind: fc.constant('restore' as const), at: fc.nat(20) }),
);

describe('the disclosure rule of section 15.2.6 (model test)', () => {
  test('changes reports exactly what a model of the full history says the reader could see', {
    timeout: 120_000,
  }, async () => {
    const runtime = await startTestRuntime(app, { tenants: ['acme'] });
    const tenant = runtime.tenants.acme;
    const call = async (who: ReturnType<typeof testPrincipal>, action: string, input: unknown) =>
      runtime.invoker.invoke<unknown, Record<string, unknown>>({
        action,
        input,
        carrier: testCarrier(tenant, who),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        commandId: crypto.randomUUID(),
      });
    const writer = testPrincipal('w', { claims: { seed: true } });
    const visible = (
      row: { owner: string; level: number; archived: boolean },
      who: { subject: string | null; claims: Readonly<Record<string, unknown>> },
    ): boolean =>
      !row.archived &&
      row.level !== 9 &&
      ((who.claims.useMine === true && row.owner === who.subject) ||
        row.level <= Number(who.claims.threshold ?? -1));

    await fc.assert(
      fc.asyncProperty(
        fc.array(opArbitrary, { minLength: 1, maxLength: 8 }),
        fc.record({
          useMine: fc.boolean(),
          threshold: fc.integer({ min: -1, max: 9 }),
          subject: owners,
        }),
        fc.nat(8),
        async (ops, claims, pick) => {
          const reader = testPrincipal(claims.subject, {
            claims: { useMine: claims.useMine, threshold: claims.threshold },
          });
          const ids: string[] = [];
          const model = new Map<string, { owner: string; level: number; archived: boolean }>();
          const snapshots: Snapshot[] = [];
          const states: string[] = [];
          const touches: Set<string>[] = [];
          let touching = new Set<string>();
          const record = async () => {
            touches.push(touching);
            touching = new Set();
            snapshots.push({ rows: new Map([...model].map(([id, row]) => [id, { ...row }])) });
            const got = await call(reader, 'notes.note.get', { ids: [] });
            if (!got.ok) throw got.error;
            states.push((got.value as { state: string }).state);
          };
          await record();
          for (const op of ops) {
            const id = op.kind === 'create' ? undefined : ids[op.at % Math.max(ids.length, 1)];
            if (op.kind === 'create') {
              const out = await call(writer, 'notes.note.create', {
                owner: op.owner,
                level: op.level,
              });
              if (!out.ok) throw out.error;
              const created = out.value as { id: string };
              ids.push(created.id);
              touching.add(created.id);
              model.set(created.id, { owner: op.owner, level: op.level, archived: false });
            } else if (id !== undefined) {
              const row = model.get(id);
              if (row === undefined) continue;
              const input =
                op.kind === 'update' ? { id, owner: op.owner, level: op.level } : { id };
              const out = await call(writer, `notes.note.${op.kind}`, input);
              if (!out.ok) continue;
              touching.add(id);
              if (op.kind === 'update') Object.assign(row, { owner: op.owner, level: op.level });
              if (op.kind === 'archive') row.archived = true;
              if (op.kind === 'restore') row.archived = false;
            } else continue;
            await record();
          }
          const from = pick % states.length;
          const token = states[from];
          if (token === undefined) return;
          const answer = await call(reader, 'notes.note.changes', {
            since: token,
            max: 500,
          });
          if (!answer.ok) throw answer.error;
          const result = answer.value as {
            created: string[];
            changed: string[];
            archived: string[];
            cannotCalculateChanges?: boolean;
          };
          expect(result.cannotCalculateChanges).toBeUndefined();
          const before = snapshots[from]?.rows ?? new Map();
          const after = snapshots.at(-1)?.rows ?? new Map();
          const expected = {
            created: [] as string[],
            changed: [] as string[],
            archived: [] as string[],
          };
          for (const id of ids) {
            if (!touches.slice(from + 1).some((set) => set.has(id))) continue;
            const now = after.get(id);
            const then = before.get(id);
            const readableNow =
              now !== undefined && visible(now, { subject: claims.subject, claims });
            const readableThen =
              then !== undefined && visible(then, { subject: claims.subject, claims });
            if (readableNow) (then === undefined ? expected.created : expected.changed).push(id);
            else if (readableThen) expected.archived.push(id);
          }
          // Only ids the reader could ever have seen may appear.
          for (const list of [result.created, result.changed, result.archived]) list.sort();
          for (const list of Object.values(expected)) list.sort();
          expect({
            created: result.created,
            changed: result.changed,
            archived: result.archived,
          }).toEqual(expected);
        },
      ),
      { numRuns: 60 },
    );
    await runtime.stop();
  });
});
