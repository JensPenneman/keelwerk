import { freshName, sendCall } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { connectKitSocket } from './support/connect-kit-socket.ts';
import {
  contactVersions,
  labelledContactsApp,
  olderLabel,
} from './support/labelled-contacts-app.ts';
import { startStreamRuntime } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const kit = await startStreamRuntime({ listen: { port: 0 } }, { app: labelledContactsApp });
afterAll(() => kit.runtime.stop());

describe('keelwerk.live.v1 at an older API version', () => {
  test('each item is translated once, for the version the hello named; the SSE carrier says the same', async () => {
    const ada = freshName('ada');
    const title = freshName('Ada');
    const watch = { action: 'contacts.contactEvents', input: {} };
    const sockets = {
      older: await connectKitSocket(kit, ada, { apiVersion: contactVersions.older }),
      head: await connectKitSocket(kit, ada, { apiVersion: contactVersions.head }),
    };
    const streams = {
      older: await kit.target.codec.subscribe?.(kit.target, {
        ...watch,
        caller: { subject: ada, headers: { 'keelwerk-version': contactVersions.older } },
      }),
      head: await kit.target.codec.subscribe?.(kit.target, {
        ...watch,
        caller: { subject: ada, headers: { 'keelwerk-version': contactVersions.head } },
      }),
    };
    try {
      for (const [version, client] of Object.entries(sockets)) {
        expect(await client.next()).toMatchObject({
          type: 'welcome',
          apiVersion: contactVersions[version as keyof typeof contactVersions],
        });
        client.send({ type: 'subscribe', id: 'c', ...watch });
        await client.until((message) => message.type === 'head');
      }
      for (const stream of Object.values(streams)) {
        await stream?.until((frame) => frame.event === 'head');
      }
      const created = (
        await sendCall(kit.target, {
          action: 'contacts.contact.create',
          input: { displayName: title },
          caller: { subject: ada, headers: { 'keelwerk-version': contactVersions.head } },
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
      // The invoker translates each item once: a second translation would put the label twice.
      for (const item of [older.socket, older.sse]) {
        expect(item).toMatchObject({ displayName: `${olderLabel}${title}` });
      }
      for (const item of [head.socket, head.sse]) {
        expect(item).toMatchObject({ displayName: title });
      }
    } finally {
      await Promise.all(Object.values(sockets).map((client) => client.close()));
      await Promise.all(Object.values(streams).map((stream) => stream?.close()));
    }
  });
});
