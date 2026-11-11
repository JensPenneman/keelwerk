import type { IncomingMessage } from 'node:http';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { errors } from '../errors/errors.ts';

/** The most an executor reads of one answer. */
const maxBodyBytes = 1024 * 1024;

function readBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        response.destroy();
        reject(errors.unsupported('The answer is larger than 1 MiB.'));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    response.on('error', reject);
  });
}

/**
 * One request to an address that was already checked: the connection goes to `address` whatever
 * the name resolves to later (the lookup is pinned), no environment proxy is used (the request has
 * an agent of its own that keeps no connection alive, so the connection is the one to the pinned
 * address, and a deployment that must go through a proxy needs an explicit option that does not
 * exist yet), redirects are not followed, and the answer's
 * body is read up to 1 MiB (`unsupported` beyond it). A failure to connect or to read is
 * `unavailable` and carries no part of the URL; an aborted request rejects with the abort error.
 */
export function sendEgressRequest(
  url: URL,
  address: { readonly address: string; readonly family: 4 | 6 },
  init: {
    readonly method?: string;
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
  },
): Promise<{ readonly status: number; readonly text: string }> {
  const pinned: LookupFunction = (_host, options, callback) => {
    if (options.all === true) {
      (callback as unknown as (error: null, addresses: unknown) => void)(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const agent =
    url.protocol === 'https:'
      ? new HttpsAgent({ keepAlive: false })
      : new HttpAgent({ keepAlive: false });
  return new Promise<{ readonly status: number; readonly text: string }>((resolve, reject) => {
    const outgoing = send(
      url,
      {
        agent,
        method: init.method ?? 'GET',
        headers: {
          ...(init.body === undefined ? {} : { 'content-length': Buffer.byteLength(init.body) }),
          ...init.headers,
        },
        lookup: pinned,
        ...(init.signal === undefined ? {} : { signal: init.signal }),
      },
      (response) => {
        readBody(response).then(
          (text) => {
            resolve({ status: response.statusCode ?? 0, text });
          },
          (error: unknown) => {
            reject(error);
          },
        );
      },
    );
    outgoing.on('error', (error: Error) => {
      reject(error.name === 'AbortError' ? error : errors.unavailable('The request failed.'));
    });
    outgoing.end(init.body);
  }).finally(() => {
    agent.destroy();
  });
}
