import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

const guid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const sockets = new Set<Socket>();
let server: Server | undefined;

/** An unmasked server frame. */
export function frame(opcode: number, payload: Buffer, isFinal = true): Buffer {
  const head =
    payload.length < 126
      ? Buffer.from([(isFinal ? 0x80 : 0) | opcode, payload.length])
      : Buffer.from([
          (isFinal ? 0x80 : 0) | opcode,
          126,
          payload.length >> 8,
          payload.length & 255,
        ]);
  return Buffer.concat([head, payload]);
}

/** The opcodes and unmasked bodies of the masked client frames in a buffer (small frames only). */
export function bodies(data: Buffer): { opcode: number; masked: boolean; body: Buffer }[] {
  const frames: { opcode: number; masked: boolean; body: Buffer }[] = [];
  let at = 0;
  while (at < data.length) {
    const opcode = (data[at] ?? 0) & 15;
    const masked = ((data[at + 1] ?? 0) & 0x80) !== 0;
    const length = (data[at + 1] ?? 0) & 127;
    const mask = data.subarray(at + 2, at + 6);
    const body = Buffer.from(data.subarray(at + 6, at + 6 + length));
    for (let index = 0; index < body.length; index += 1) {
      body[index] = (body[index] ?? 0) ^ (mask[index % 4] ?? 0);
    }
    frames.push({ opcode, masked, body });
    at += 6 + length;
  }
  return frames;
}

/** The payloads of the masked client frames in a buffer (small frames only). */
export function unmasked(data: Buffer): { opcode: number; payload: string }[] {
  return bodies(data).map(({ opcode, masked, body }) => ({
    opcode,
    payload: `${masked ? 'masked:' : 'plain:'}${body.toString('utf8')}`,
  }));
}

/** Stops the server of the test and destroys the sockets it accepted; register it with `afterEach`. */
export async function stopServer(): Promise<void> {
  const closing = server;
  server = undefined;
  if (closing === undefined) return;
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await new Promise((resolve) => closing.close(resolve));
}

export async function listen(
  onUpgrade: (request: IncomingMessage, socket: Socket) => void,
): Promise<number> {
  const created = createServer();
  created.on('upgrade', (request, socket: Socket) => {
    sockets.add(socket);
    onUpgrade(request, socket);
  });
  server = created;
  await new Promise<void>((resolve) => created.listen(0, '127.0.0.1', resolve));
  return (created.address() as AddressInfo).port;
}

export function accept(request: IncomingMessage, socket: Socket, protocol?: string): void {
  const key = String(request.headers['sec-websocket-key']);
  const answer = createHash('sha1').update(`${key}${guid}`).digest('base64');
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${answer}`,
      ...(protocol === undefined ? [] : [`Sec-WebSocket-Protocol: ${protocol}`]),
      '',
      '',
    ].join('\r\n'),
  );
}

export const upgradeRequest = (path = '/live', headers: Record<string, string> = {}): Request =>
  new Request(`https://acme.example.test${path}`, { headers });
