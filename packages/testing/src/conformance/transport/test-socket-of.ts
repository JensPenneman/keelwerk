import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { TestSocket } from './test-socket.ts';

type Closed = { readonly code: number; readonly reason: string };
type Message = string | Uint8Array;
const maxLength = 2 ** 31;

/** One masked client frame (RFC 6455 section 5.2): FIN set, no extension bit. */
function frameOf(opcode: number, payload: Uint8Array): Buffer {
  const size = payload.length;
  const head =
    size < 126
      ? Buffer.from([0x80 | opcode, 0x80 | size])
      : size < 65_536
        ? Buffer.from([0x80 | opcode, 0x80 | 126, size >> 8, size & 255])
        : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), Buffer.alloc(8)]);
  if (size >= 65_536) head.writeBigUInt64BE(BigInt(size), 2);
  const mask = randomBytes(4);
  const body = Buffer.from(payload);
  for (let index = 0; index < body.length; index += 1) {
    body[index] = (body[index] ?? 0) ^ (mask[index % 4] ?? 0);
  }
  return Buffer.concat([head, mask, body]);
}

/**
 * The client side of RFC 6455 framing on an upgraded socket; `head` is what the upgrade read past
 * the 101. A server ping is answered by a pong of the same payload at once, as a browser does,
 * unless `answerPings` is false.
 */
export function testSocketOf(
  socket: Duplex,
  head: Uint8Array,
  options: { readonly answerPings?: boolean } = {},
): TestSocket {
  const answerPings = options.answerPings !== false;
  const queue: Message[] = [];
  const waiters: { resolve(message: Message): void; reject(error: Error): void }[] = [];
  const pongs: {
    readonly payload: Uint8Array;
    resolve(payload: Uint8Array): void;
    reject(error: Error): void;
  }[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer: Buffer = Buffer.from(head);
  let fragments: Buffer[] = [];
  let fragmentOpcode = 0;
  let settled: Closed | undefined;
  let closeSent = false;
  let resolveClosed: (value: Closed) => void = () => undefined;
  const closed = new Promise<Closed>((resolve) => {
    resolveClosed = resolve;
  });
  const gone = new Promise<void>((resolve) => {
    if (socket.destroyed) resolve();
    else socket.once('close', () => resolve());
  });

  const settle = (value: Closed): void => {
    if (settled !== undefined) return;
    settled = value;
    resolveClosed(value);
    for (const waiter of [...waiters.splice(0), ...pongs.splice(0)]) {
      waiter.reject(new Error(`The socket is closed (${value.code}).`));
    }
  };
  const fail = (): void => {
    settle({ code: 1002, reason: '' });
    socket.destroy();
  };
  const write = (opcode: number, payload: Uint8Array): void => {
    if (!socket.destroyed && socket.writable) socket.write(frameOf(opcode, payload));
  };
  const deliver = (message: Message): void => {
    const waiter = waiters.shift();
    if (waiter === undefined) queue.push(message);
    else waiter.resolve(message);
  };
  const finish = (opcode: number, payload: Buffer): void => {
    try {
      deliver(opcode === 1 ? decoder.decode(payload) : new Uint8Array(payload));
    } catch {
      fail();
    }
  };
  const control = (opcode: number, payload: Buffer): void => {
    if (opcode === 9) {
      if (answerPings) write(10, payload);
    } else if (opcode === 10) {
      // A pong answers the first ping with the same payload; a late or unsolicited one matches none.
      const at = pongs.findIndex((pong) => Buffer.compare(pong.payload, payload) === 0);
      if (at >= 0) pongs.splice(at, 1)[0]?.resolve(new Uint8Array(payload));
    } else if (opcode === 8) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      let reason = '';
      try {
        reason = decoder.decode(payload.subarray(2));
      } catch {
        fail();
        return;
      }
      settle({ code, reason });
      if (!closeSent) {
        closeSent = true;
        write(8, payload.subarray(0, 2));
      }
      socket.end();
    }
  };

  const parse = (): void => {
    while (settled === undefined && buffer.length >= 2) {
      const first = buffer[0] ?? 0;
      const second = buffer[1] ?? 0;
      const opcode = first & 15;
      const isFinal = (first & 0x80) !== 0;
      const known = opcode <= 2 || (opcode >= 8 && opcode <= 10);
      if ((first & 0x70) !== 0 || (second & 0x80) !== 0 || !known) {
        fail();
        return;
      }
      let length = second & 127;
      let offset = 2;
      if (length === 126 || length === 127) {
        offset = length === 126 ? 4 : 10;
        if (buffer.length < offset) return;
        const wide = length === 126 ? buffer.readUInt16BE(2) : buffer.readBigUInt64BE(2);
        if (wide >= maxLength) {
          fail();
          return;
        }
        length = Number(wide);
      }
      if (opcode >= 8 && (!isFinal || length > 125)) {
        fail();
        return;
      }
      if (buffer.length < offset + length) return;
      const payload = buffer.subarray(offset, offset + length);
      buffer = buffer.subarray(offset + length);
      if (opcode >= 8) {
        control(opcode, payload);
      } else if (opcode === 0) {
        if (fragments.length === 0) {
          fail();
          return;
        }
        fragments.push(payload);
        if (isFinal) {
          finish(fragmentOpcode, Buffer.concat(fragments));
          fragments = [];
        }
      } else if (fragments.length > 0) {
        fail();
        return;
      } else if (isFinal) {
        finish(opcode, payload);
      } else {
        fragmentOpcode = opcode;
        fragments = [payload];
      }
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    parse();
  });
  socket.on('end', () => {
    settle({ code: 1006, reason: '' });
    socket.end();
  });
  socket.on('error', () => settle({ code: 1006, reason: '' }));
  socket.on('close', () => settle({ code: 1006, reason: '' }));
  parse();

  return {
    send(data) {
      write(typeof data === 'string' ? 1 : 2, typeof data === 'string' ? Buffer.from(data) : data);
    },
    next(ms = 10_000) {
      const ready = queue.shift();
      if (ready !== undefined) return Promise.resolve(ready);
      if (settled !== undefined) {
        return Promise.reject(new Error(`The socket is closed (${settled.code}).`));
      }
      return new Promise<Message>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`No message within ${ms} ms.`));
        }, ms);
        const waiter = {
          resolve(message: Message) {
            clearTimeout(timer);
            resolve(message);
          },
          reject(error: Error) {
            clearTimeout(timer);
            reject(error);
          },
        };
        waiters.push(waiter);
      });
    },
    ping(payload = randomBytes(8), ms = 10_000) {
      if (payload.length > 125) {
        return Promise.reject(new RangeError('A ping carries at most 125 bytes.'));
      }
      if (settled !== undefined) {
        return Promise.reject(new Error(`The socket is closed (${settled.code}).`));
      }
      return new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          pongs.splice(pongs.indexOf(pong), 1);
          reject(new Error(`No pong within ${ms} ms.`));
        }, ms);
        const pong = {
          payload,
          resolve(answer: Uint8Array) {
            clearTimeout(timer);
            resolve(answer);
          },
          reject(error: Error) {
            clearTimeout(timer);
            reject(error);
          },
        };
        pongs.push(pong);
        write(9, payload);
      });
    },
    closed,
    async close(code = 1000, reason = '') {
      if (!closeSent) {
        const text = Buffer.from(reason);
        if (!Number.isInteger(code) || code < 0 || code > 65_535 || text.length > 123) {
          throw new RangeError(
            'A close frame carries a 16-bit code and a reason of at most 123 bytes.',
          );
        }
        closeSent = true;
        write(8, Buffer.concat([Buffer.from([code >> 8, code & 255]), text]));
      }
      const timer = setTimeout(() => socket.destroy(), 2000);
      try {
        await gone;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
