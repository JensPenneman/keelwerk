import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { sendToCardBoard, startCardBoard } from './support/card-board-kit.ts';

type Card = { id: string; title: string; shown: boolean };

const stops: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.allSettled(stops.map((stop) => stop()));
});

test('on PostgreSQL an update that patches the title leaves a hidden card hidden, in process and over HTTP', {
  timeout: 180_000,
}, async () => {
  const database = await createTestDatabase('generated_update_defaults');
  const runtime = await startCardBoard({
    external: {
      factory: postgresAdapter({ ownerUrl: database.adminUrl }),
      url: database.appUrl,
    },
  });
  stops.push(() => runtime.stop());
  const board = createLocalClient(runtime, { principal: testPrincipal('ada') });
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
  const invoke = async (action: string, input: unknown) => {
    const answer = await sendToCardBoard(runtime, '/_keelwerk/v1/invoke', {
      body: { action, input },
    });
    expect(answer.status, await answer.clone().text()).toBe(200);
    return ((await answer.json()) as { value: unknown }).value;
  };
  const remote = (await invoke('board.card.create', { owner: 'ada', title: 'A' })) as {
    id: string;
  };
  await invoke('board.card.update', { id: remote.id, patch: { shown: false } });
  await invoke('board.card.update', { id: remote.id, patch: { title: 'E' } });
  const back = (await invoke('board.card.get', { ids: [remote.id] })) as { list: Card[] };
  expect(back.list[0]).toMatchObject({ shown: false, title: 'E' });
});
