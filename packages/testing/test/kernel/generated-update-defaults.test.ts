import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { type cardBoardApp, sendToCardBoard, startCardBoard } from './support/card-board-kit.ts';

type Card = { id: string; title: string; shown: boolean };

describe.each(['memory', 'pglite'] as const)('a generated update on %s', (adapter) => {
  let runtime: TestRuntime<typeof cardBoardApp>;
  beforeAll(async () => {
    runtime = await startCardBoard({ adapter });
  }, 120_000);
  afterAll(() => runtime.stop());

  const client = () => createLocalClient(runtime, { principal: testPrincipal('ada') });
  const invoke = async (action: string, input: unknown): Promise<unknown> => {
    const answer = await sendToCardBoard(runtime, '/_keelwerk/v1/invoke', {
      body: { action, input },
    });
    expect(answer.status, await answer.clone().text()).toBe(200);
    return ((await answer.json()) as { value: unknown }).value;
  };

  test('an update that patches the title leaves a hidden card hidden (local client)', async () => {
    const board = client();
    const created = await board.invoke('board.card.create', { owner: 'ada', title: 'A' });
    expect(created.shown).toBe(true);
    await board.invoke('board.card.update', { id: created.id, patch: { shown: false } });
    const updated = await board.invoke('board.card.update', {
      id: created.id,
      patch: { title: 'B' },
    });
    expect(updated.shown).toBe(false);
    const read = await board.invoke('board.card.get', { ids: [created.id] });
    expect(read.list[0]).toMatchObject({ shown: false, title: 'B' });
  });

  test('the update items of set leave the omitted field as it is', async () => {
    const board = client();
    const created = await board.invoke('board.card.create', { owner: 'ada', title: 'A' });
    await board.invoke('board.card.update', { id: created.id, patch: { shown: false } });
    await board.invoke('board.card.set', {
      update: [{ id: created.id, patch: { title: 'C' } }],
    });
    const read = await board.invoke('board.card.get', { ids: [created.id] });
    expect(read.list[0]).toMatchObject({ shown: false, title: 'C' });
  });

  test('over HTTP the invocation protocol and REST PATCH leave a hidden card hidden', async () => {
    const created = (await invoke('board.card.create', { owner: 'ada', title: 'A' })) as {
      id: string;
    };
    const id = created.id;
    await invoke('board.card.update', { id, patch: { shown: false } });
    await invoke('board.card.update', { id, patch: { title: 'B' } });
    const patched = await sendToCardBoard(runtime, `/api/board/cards/${id}`, {
      method: 'PATCH',
      contentType: 'application/merge-patch+json',
      body: { title: 'D' },
    });
    expect(patched.status, await patched.clone().text()).toBe(200);
    const read = (await invoke('board.card.get', { ids: [id] })) as { list: Card[] };
    expect(read.list[0]).toMatchObject({ shown: false, title: 'D' });
  });
});
