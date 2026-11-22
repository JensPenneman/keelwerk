import type { AddressInfo } from 'node:net';
import { createServer, Socket } from 'node:net';

/** The text of the NUL-terminated string that starts at `from`, and where the next field begins. */
function cString(buffer: Buffer, from: number): { text: string; next: number } {
  const end = buffer.indexOf(0, from);
  const stop = end === -1 ? buffer.length : end;
  return { text: buffer.toString('utf8', from, stop), next: stop + 1 };
}

/** What a connection's startup message says of it: the `application_name`, when it sends one. */
function applicationOf(startup: Buffer): string | undefined {
  // Length, protocol version, then pairs of strings ending with an empty key.
  let at = 8;
  while (at < startup.length) {
    const key = cString(startup, at);
    if (key.text === '') return undefined;
    const value = cString(startup, key.next);
    if (key.text === 'application_name') return value.text;
    at = value.next;
  }
  return undefined;
}

/** What the relay saw of a transaction it cut: enough to name it. */
export interface CutTransaction {
  /** The order in which the relay accepted the connection the transaction ran on, from 1. */
  readonly connection: number;
  /** The `application_name` of that connection's startup message. */
  readonly application: string | undefined;
  /** The statement whose message carried the marker. */
  readonly markedBy: string;
  /** Every statement the transaction sent, in order, each cut to 120 characters. */
  readonly statements: readonly string[];
}

/** A relay that can make a client lose the answer to a commit that the server has made. */
export interface LosingRelay {
  /** The given url, pointed at the relay. */
  readonly url: string;
  /**
   * Arms the relay once, for the one transaction that sends `marker`: the first message of any
   * connection that carries it (a statement's text or a bound parameter) marks the transaction it
   * belongs to, and that transaction's `COMMIT` is passed to the server; when the server has
   * answered it, the answer is dropped and the connection to the client is cut. The server has then
   * committed, and the client has never heard so. Every other transaction, on every connection,
   * passes untouched.
   */
  loseCommitOf(marker: string): void;
  /** The transactions cut so far, in order. */
  cuts(): readonly CutTransaction[];
  /**
   * Stops listening, ends the connections the relay accepted and opened, and answers once they have
   * ended.
   */
  close(): Promise<void>;
}

/**
 * Relays the connections of `url` through a local port; bytes pass both ways unchanged until a
 * marked transaction commits.
 */
export async function startLosingRelay(url: string): Promise<LosingRelay> {
  const target = new URL(url);
  const sockets = new Set<Socket>();
  let marker: string | undefined;
  let accepted = 0;
  const cuts: CutTransaction[] = [];
  const server = createServer((client) => {
    const upstream = new Socket();
    accepted += 1;
    const connection = accepted;
    sockets.add(client).add(upstream);
    for (const socket of [client, upstream]) {
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
    }
    let pending = Buffer.alloc(0);
    let application: string | undefined;
    let started = false;
    /**
     * The statements the client prepared, by name, so that a bound parameter names its
     * statement.
     */
    const prepared = new Map<string, string>();
    let statements: string[] = [];
    let markedBy: string | undefined;
    let losing = false;
    const endTransaction = (): void => {
      statements = [];
      markedBy = undefined;
    };
    const message = (type: string, body: Buffer): void => {
      let sql: string | undefined;
      if (type === 'Q') {
        sql = cString(body, 0).text;
        if (/^\s*begin\b/i.test(sql)) endTransaction();
        statements.push(sql.slice(0, 120));
      } else if (type === 'P') {
        const name = cString(body, 0);
        sql = cString(body, name.next).text;
        prepared.set(name.text, sql);
        statements.push(sql.slice(0, 120));
      } else if (type === 'B') {
        const portal = cString(body, 0);
        sql = prepared.get(cString(body, portal.next).text);
      }
      if (
        marker !== undefined &&
        markedBy === undefined &&
        (type === 'Q' || type === 'P' || type === 'B') &&
        body.includes(marker)
      ) {
        markedBy = (sql ?? '').slice(0, 120);
      }
      if (type === 'Q' && /^\s*commit\b/i.test(sql ?? '')) {
        if (marker !== undefined && markedBy !== undefined) {
          marker = undefined;
          losing = true;
          cuts.push({ connection, application, markedBy, statements: [...statements] });
        }
        endTransaction();
      }
    };
    const read = (chunk: Buffer): void => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        if (!started) {
          // The startup message has no type byte: its length comes first. An SSL request is as
          // long, but what follows it is not readable here: such a connection is only relayed.
          if (pending.length < 4 || pending.length < pending.readInt32BE(0)) return;
          const length = pending.readInt32BE(0);
          application = applicationOf(pending.subarray(0, length));
          pending = pending.subarray(length);
          started = true;
          continue;
        }
        if (pending.length < 5) return;
        const length = pending.readInt32BE(1);
        if (pending.length < length + 1) return;
        message(String.fromCharCode(pending[0] ?? 0), pending.subarray(5, length + 1));
        pending = pending.subarray(length + 1);
      }
    };
    client.on('data', (chunk: Buffer) => {
      read(chunk);
      upstream.write(chunk);
    });
    upstream.on('data', (chunk: Buffer) => {
      if (!losing) {
        client.write(chunk);
        return;
      }
      // The answer to the commit: the server has committed. The client never hears of it.
      losing = false;
      client.destroy();
      upstream.destroy();
    });
    upstream.on('end', () => client.end());
    client.on('end', () => upstream.end());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    upstream.connect(Number(target.port), target.hostname);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const relayed = new URL(url);
  relayed.hostname = '127.0.0.1';
  relayed.port = String(port);
  return {
    url: relayed.toString(),
    loseCommitOf: (value) => {
      marker = value;
    },
    cuts: () => cuts,
    close: async () => {
      // No new connection once this has begun; the callback runs when the last one has ended, and
      // every one the relay holds is destroyed here, so it does.
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}
