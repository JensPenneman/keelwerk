import type { InlineReactionEvent } from '@keelwerk/core';
import { deriveEffectId, kernelCommandId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  command,
  effectsKit,
  eventsOf,
  reaction,
  receiptOf,
  registryWith,
  stored,
} from './support/effects-kit.ts';
import { clock, tenant } from './support/run-read-kit.ts';

type ReactionEvent = InlineReactionEvent<string, unknown, Readonly<Record<string, unknown>>>;

interface Writes {
  readonly write: {
    readonly library: {
      readonly book: {
        create(values: Record<string, unknown>): unknown;
        update(target: unknown, patch: Record<string, unknown>): unknown;
      };
    };
  };
}

const addsBook = (title: string) => (_input: unknown, ctx: Writes) => [
  ctx.write.library.book.create({ title, isbn: `${title}-1`, addedBy: 'ada' }),
];

describe('inline reactions', () => {
  test('a reaction invokes an own command in the same unit, as the module service principal', async () => {
    const registry = registryWith({
      actions: [
        command('add', addsBook('First')),
        command('note', (_i: unknown, ctx: Writes) => [
          ctx.write.library.book.create({ title: 'Noted', isbn: 'n-1', addedBy: 'system' }),
        ]),
      ],
      reactions: [
        reaction('library.noteBook', 'library.book.created', (event: ReactionEvent) =>
          (event.state as { title: string }).title === 'First'
            ? { effects: [{ kind: 'invoke', type: 'invoke', action: 'library.note', input: {} }] }
            : [],
        ),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    expect(await invoke('library.add', {}, { commandId: 'c1' })).toMatchObject({ ok: true });
    const { books } = await stored(adapter);
    expect(books.map((book) => book.title).sort()).toEqual(['First', 'Noted']);
    const noted = books.find((book) => book.title === 'Noted');
    const events = await eventsOf(adapter, 'library.book', String(noted?.id));
    expect(events[0]?.actor).toMatchObject({ kind: 'service', id: 'library.system' });
    const first = books.find((book) => book.title === 'First');
    const origin = await eventsOf(adapter, 'library.book', String(first?.id));
    const reactionId = kernelCommandId(
      'effect',
      deriveEffectId(tenant, `library.noteBook:${origin[0]?.eventId}`, 0),
    );
    expect((await receiptOf(adapter, reactionId))?.status).toBe('completed');
    expect(events[0]?.commandId).toBe(reactionId);
  });

  test('a reaction decides on the event as the unit wrote it and its drafts become events of the service principal', async () => {
    const seen: ReactionEvent[] = [];
    const registry = registryWith({
      actions: [command('add', addsBook('First'))],
      reactions: [
        reaction('library.shout', 'library.book.created', (event: ReactionEvent, ctx: Writes) => {
          seen.push(event);
          return [ctx.write.library.book.update(event.stream.id, { title: 'FIRST' })];
        }),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.add', {}, { commandId: 'c1' });
    const [book] = (await stored(adapter)).books;
    expect(book?.title).toBe('FIRST');
    expect(book?.version).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'library.book.created',
      stream: { type: 'library.book', id: book?.id },
      version: 1,
      position: null,
      commandId: 'c1',
      actor: { kind: 'user', id: 'ada' },
      state: { title: 'First' },
    });
    const events = await eventsOf(adapter, 'library.book', String(book?.id));
    expect(events.map((event) => event.type)).toEqual([
      'library.book.created',
      'library.book.changed',
    ]);
    expect(events[1]).toMatchObject({
      actor: { kind: 'service', id: 'library.system', via: 'core.module' },
      commandId: 'c1',
      action: 'library.shout',
      causationId: events[0]?.eventId,
    });
  });

  test('reactions run in module order, then by id', async () => {
    const order: string[] = [];
    const note = (id: string) => () => {
      order.push(id);
      return [];
    };
    const registry = registryWith({
      actions: [command('add', addsBook('First'))],
      reactions: [
        reaction('loans.zeta', 'library.book.created', note('loans.zeta')),
        reaction('library.beta', 'library.book.created', note('library.beta')),
        reaction('library.alpha', 'library.book.created', note('library.alpha')),
      ],
    });
    const { invoke } = effectsKit(registry);
    await invoke('library.add', {});
    expect(order).toEqual(['library.alpha', 'library.beta', 'loans.zeta']);
  });

  test.each([
    [8, true],
    [9, false],
  ])('a chain of %i reactions %s', async (limit, passes) => {
    let calls = 0;
    const registry = registryWith({
      actions: [command('add', addsBook('First'))],
      reactions: [
        reaction('library.chain', 'library.book.created', (_e: unknown, ctx: Writes) => {
          calls += 1;
          return calls < limit
            ? [
                ctx.write.library.book.create({
                  title: `B${calls}`,
                  isbn: `b-${calls}`,
                  addedBy: 'x',
                }),
              ]
            : [];
        }),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    const outcome = await invoke('library.add', {}, { commandId: 'c1' });
    if (passes) {
      expect(outcome).toMatchObject({ ok: true });
      expect((await stored(adapter)).books).toHaveLength(limit);
    } else {
      expect(!outcome.ok && outcome.error.code).toBe('core.reaction_depth');
      expect((await stored(adapter)).books).toHaveLength(0);
      expect(await receiptOf(adapter, 'c1')).toBeUndefined();
    }
  });

  test('a failing reaction rolls the command back', async () => {
    const registry = registryWith({
      actions: [command('add', addsBook('First'))],
      reactions: [
        reaction('library.fails', 'library.book.created', () => {
          throw new Error('nope');
        }),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    expect((await invoke('library.add', {}, { commandId: 'c1' })).ok).toBe(false);
    expect((await stored(adapter)).books).toHaveLength(0);
  });

  test('a module service principal may invoke only its own module without a rule', async () => {
    const registry = registryWith({
      actions: [command('add', addsBook('First'))],
      reactions: [
        reaction('library.lends', 'library.book.created', () => ({
          effects: [
            {
              kind: 'invoke',
              type: 'invoke',
              action: 'loans.lend',
              input: { bookTitle: 'x', dueAt: clock.now() },
            },
          ],
        })),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    const outcome = await invoke('library.add', {}, { commandId: 'c1' });
    expect(!outcome.ok && outcome.error.kind).toBe('forbidden');
    expect((await stored(adapter)).books).toHaveLength(0);
  });

  test('a reaction to another event does not run, and the fixture reaction still does', async () => {
    let ran = 0;
    const registry = registryWith({
      keepReactions: true,
      actions: [command('add', addsBook('First'))],
      reactions: [
        reaction('library.other', 'library.book.changed', () => {
          ran += 1;
          return [];
        }),
      ],
    });
    const { invoke } = effectsKit(registry);
    expect(await invoke('library.add', {})).toMatchObject({ ok: true });
    expect(ran).toBe(0);
  });

  test('events come first, reactions second: rA(e1), rB(e1), rA(e2), rB(e2)', async () => {
    const order: string[] = [];
    const note = (name: string) => (event: ReactionEvent) => {
      order.push(`${name}:${(event.state as { title: string }).title}`);
      return [];
    };
    const registry = registryWith({
      actions: [
        command('addTwo', (_i: unknown, ctx: Writes) => [
          ctx.write.library.book.create({ title: 'one', isbn: 'o-1', addedBy: 'ada' }),
          ctx.write.library.book.create({ title: 'two', isbn: 'o-2', addedBy: 'ada' }),
        ]),
      ],
      reactions: [
        reaction('library.a', 'library.book.created', note('a')),
        reaction('library.b', 'library.book.created', note('b')),
      ],
    });
    const { invoke } = effectsKit(registry);
    expect(await invoke('library.addTwo', {}, { commandId: 'c1' })).toMatchObject({ ok: true });
    expect(order).toEqual(['a:one', 'b:one', 'a:two', 'b:two']);
  });

  test('a reaction sees the row right after its own event, not after the last event of the decision', async () => {
    const seen: string[] = [];
    const registry = registryWith({
      actions: [
        command('addAndRename', (_i: unknown, ctx: Writes) => {
          const created = ctx.write.library.book.create({
            title: 'Before',
            isbn: 'b-1',
            addedBy: 'ada',
          }) as { id: string };
          return [created, ctx.write.library.book.update(created.id, { title: 'After' })];
        }),
      ],
      reactions: [
        reaction('library.watch', 'library.book.created', (event: ReactionEvent) => {
          seen.push((event.state as { title: string }).title);
          return [];
        }),
      ],
    });
    const { invoke } = effectsKit(registry);
    expect(await invoke('library.addAndRename', {}, { commandId: 'c1' })).toMatchObject({
      ok: true,
    });
    expect(seen).toEqual(['Before']);
  });
});
