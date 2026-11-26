import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';

/**
 * Ports 20000 to 29999: below the range Docker Desktop's virtual machine picks published ports
 * from (about 32768 up) and below the range the operating system gives outgoing connections
 * (49152 up on macOS, 32768 up on Linux), so neither's own pick falls in it.
 */
const testRange = { first: 20_000, last: 29_999 };

/**
 * The addresses a container runtime can publish on or a client can reach a published port by: every
 * IPv4 address, every IPv6 address (which also covers IPv4 where the system maps it), and the two
 * loopback addresses. A listener on any one of them is a collision with a publish.
 */
const addresses = ['0.0.0.0', '::', '127.0.0.1', '::1'];

/** An address this host does not have or cannot use (no IPv6, say) holds nothing. */
const absent = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);

/** Whether this process can listen on the port at the address right now. */
function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
      else if (error.code !== undefined && absent.has(error.code)) resolve(true);
      else reject(error);
    });
    probe.listen({ port, host, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

/** Whether the port can be listened on at every one of the addresses, one after the other. */
async function isFree(port: number): Promise<boolean> {
  for (const host of addresses) {
    if (!(await canListen(port, host))) return false;
  }
  return true;
}

/**
 * A host port to publish a test container on, so that the container runtime never picks one
 * (a runtime's own pick can fall on a port the host cannot listen on, and a start then waits
 * for a port forward that never comes). It tries the ports of the range one after the other,
 * from `from` (a random port of the range by default; a start outside the range is moved into it),
 * and answers the first port on which this process can listen at once on 0.0.0.0, on `::`, on
 * 127.0.0.1 and on `::1` (an address the host does not have counts as free). A port that something
 * holds on any of them is skipped. It rejects naming the range when no port is left. Between this
 * answer and the container's start another process can still take the port. A runtime that refuses
 * it then fails the start at once; Docker Desktop does not: its forwarder keeps trying, and the
 * start ends only at the container library's own wait.
 */
export async function freeHostPort(
  range: { readonly first: number; readonly last: number } = testRange,
  from: number = randomInt(range.first, range.last + 1),
): Promise<number> {
  const size = range.last - range.first + 1;
  const start = (((from - range.first) % size) + size) % size;
  for (let step = 0; step < size; step += 1) {
    const port = range.first + ((start + step) % size);
    if (await isFree(port)) return port;
  }
  throw new Error(
    `No host port from ${range.first} to ${range.last} can be listened on at 0.0.0.0, ::, 127.0.0.1 and ::1.`,
  );
}
