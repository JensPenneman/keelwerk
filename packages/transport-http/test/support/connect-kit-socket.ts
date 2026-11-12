import { requestHeaders } from '@keelwerk/testing';
import { connectLiveSocket } from './connect-live-socket.ts';
import type { LiveSocketClient } from './live-socket-client.ts';
import type { StreamRuntime } from './stream-runtime.ts';

/** A client of the kit's first tenant, signed in as `subject`, with its hello already sent (`hello` adds members to it). */
export async function connectKitSocket(
  kit: StreamRuntime,
  subject: string,
  hello: Record<string, unknown> = {},
): Promise<LiveSocketClient> {
  const { port } = kit.runtime.runtime;
  const domain = Object.values(kit.runtime.domains)[0];
  if (port === undefined || domain === undefined) throw new Error('the runtime is not listening');
  const client = await connectLiveSocket(
    port,
    domain,
    Object.fromEntries(requestHeaders({ subject })),
  );
  if (!('socket' in client)) throw new Error(`the upgrade was refused: ${client.status}`);
  client.send({ type: 'hello', ...hello });
  return client;
}
