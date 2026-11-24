import { createFakeHost, type SentRequest } from './fake-host.ts';
import { json, portalServer } from './portal-server.ts';
import { remoteProfileFiles } from './profile-files.ts';

export const token = (n: number): string => `v2.0.${n}.00000000.${'0'.repeat(32)}`;

export function sse(...events: readonly string[]): Response {
  return new Response(events.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}
export const welcome = 'event: welcome\ndata: {"protocol":1}\n\n';
export const followItem = (n: number, value: unknown): string =>
  `id: ${token(n)}\nevent: data\ndata: ${JSON.stringify(value)}\n\n`;
export const followHead = (n: number): string =>
  `id: ${token(n)}\nevent: head\ndata: {"state":"${token(n)}"}\n\n`;
export const end = 'event: end\ndata: {"reason":"complete"}\n\n';

/** A deployment whose `/subscribe` answers the scripted streams in turn; the requests it got are kept. */
export function followDeployment(streams: readonly (() => Response)[]) {
  const opened: Record<string, unknown>[] = [];
  const firstOpen = Promise.withResolvers<void>();
  const handler = portalServer({
    invoke: (body, sent: SentRequest) => {
      if (!sent.url.endsWith('/subscribe')) return json({ ok: true, value: null });
      opened.push(body);
      firstOpen.resolve();
      const next = streams[opened.length - 1];
      if (next === undefined) throw new Error(`The test opened subscription ${opened.length}.`);
      return next();
    },
  });
  return {
    fake: createFakeHost({ files: remoteProfileFiles, handler }),
    opened,
    /** Settles when the first `/subscribe` request has arrived. */
    firstOpen: firstOpen.promise,
  };
}

export const outputLines = (text: string): string[] =>
  text.split('\n').filter((line) => line !== '');
