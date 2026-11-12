import { freshName, sendCall } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { connectKitSocket } from './support/connect-kit-socket.ts';
import { peopleVersions, renamedPeopleApp } from './support/renamed-people-app.ts';
import { startStreamRuntime } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const kit = await startStreamRuntime({ listen: { port: 0 } }, { app: renamedPeopleApp });
afterAll(() => kit.runtime.stop());

describe('the generated watch at an older API version', () => {
  test('at the older version the item row says name, at the head displayName, over SSE and the socket', async () => {
    const ada = freshName('ada');
    const title = freshName('Ada');
    const watch = { action: 'people.person.watch', input: {} };
    const sockets = {
      older: await connectKitSocket(kit, ada, { apiVersion: peopleVersions.older }),
      head: await connectKitSocket(kit, ada, { apiVersion: peopleVersions.head }),
    };
    const streams = {
      older: await kit.target.codec.subscribe?.(kit.target, {
        ...watch,
        caller: { subject: ada, headers: { 'keelwerk-version': peopleVersions.older } },
      }),
      head: await kit.target.codec.subscribe?.(kit.target, {
        ...watch,
        caller: { subject: ada, headers: { 'keelwerk-version': peopleVersions.head } },
      }),
    };
    try {
      for (const client of Object.values(sockets)) {
        expect(await client.next()).toMatchObject({ type: 'welcome' });
        client.send({ type: 'subscribe', id: 'c', ...watch });
        await client.until((message) => message.type === 'head');
      }
      for (const stream of Object.values(streams)) {
        await stream?.until((frame) => frame.event === 'head');
      }
      const created = (
        await sendCall(kit.target, {
          action: 'people.person.create',
          input: { displayName: title },
          caller: { subject: ada, headers: { 'keelwerk-version': peopleVersions.head } },
        })
      ).decoded;
      expect(created.ok).toBe(true);
      const itemOf = async (version: 'older' | 'head') => {
        const socket = (await sockets[version].until((message) => message.type === 'data')).at(-1);
        const frame = (
          await streams[version]?.until((candidate) => candidate.event === 'data')
        )?.at(-1);
        return { socket: (socket as { item: unknown }).item, sse: frame?.data };
      };
      const older = await itemOf('older');
      const head = await itemOf('head');
      for (const item of [older.socket, older.sse]) {
        expect(item).toMatchObject({ type: 'created', row: { name: title } });
        expect((item as { row: object }).row).not.toHaveProperty('displayName');
      }
      for (const item of [head.socket, head.sse]) {
        expect(item).toMatchObject({ type: 'created', row: { displayName: title } });
        expect((item as { row: object }).row).not.toHaveProperty('name');
      }
    } finally {
      await Promise.all(Object.values(sockets).map((client) => client.close()));
      await Promise.all(Object.values(streams).map((stream) => stream?.close()));
    }
  });
});
