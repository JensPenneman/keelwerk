import { expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { originOf } from './origin-of.ts';
import { requestHeaders } from './request-headers.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/** The first `count` server-sent frames of a `/subscribe` stream, as `event` names with their parsed `data`. */
async function framesOf(
  target: TransportTarget,
  subject: string,
  after?: string,
  count = 2,
): Promise<readonly { readonly event: string; readonly data: unknown }[]> {
  const caller = { subject };
  const query = new URLSearchParams({ action: 'loans.loanEvents', input: '{}' });
  if (after !== undefined) query.set('after', after);
  const response = await target.fetch(
    new Request(
      `${originOf(target, caller)}${target.codec.subscribePath ?? ''}?${query.toString()}`,
      {
        headers: requestHeaders(caller),
      },
    ),
  );
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (reader !== undefined && text.split('\n\n').length <= count) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value);
  }
  await reader?.cancel();
  return text
    .split('\n\n')
    .filter((block) => block.includes('event:'))
    .slice(0, count)
    .map((block) => ({
      event: /event: (.*)/.exec(block)?.[1] ?? '',
      data: JSON.parse(/data: (.*)/.exec(block)?.[1] ?? 'null'),
    }));
}

/**
 * The scenarios that need `@keelwerk/live` (S-39, S-62): written against the planned endpoints
 * and skipped under the marker `m2`, so the suite names what the second milestone must add.
 */
export function subscriptionCases(target: TransportTarget): void {
  test.skip('m2: a subscription streams a head frame, then the rows that change', async () => {
    const ada = freshName('ada');
    const [head] = await framesOf(target, ada, undefined, 1);
    expect(head?.event).toBe('head');
    await sendCall(target, lendCall(ada, freshName('Dune')));
    const frames = await framesOf(target, ada, undefined, 2);
    expect(frames.map((frame) => frame.event)).toEqual(['head', 'created']);
  });

  test.skip('m2: a subscription resumes after the last state token it saw', async () => {
    const ada = freshName('ada');
    await sendCall(target, lendCall(ada, freshName('Emma')));
    const [first] = await framesOf(target, ada, undefined, 1);
    const token = (first?.data as { state?: string } | undefined)?.state;
    await sendCall(target, lendCall(ada, freshName('Hamlet')));
    const resumed = await framesOf(target, ada, token, 1);
    expect(resumed.map((frame) => frame.event)).toEqual(['created']);
  });

  test.skip('m2: a resume older than the retention horizon answers a reset frame', async () => {
    const stale = 'v1.0.0.stale.invalid';
    const frames = await framesOf(target, freshName('ada'), stale, 1);
    expect(frames.map((frame) => frame.event)).toEqual(['reset']);
  });

  test.skip('m2: a cross-site page cannot open the live stream with the user’s cookie', async () => {
    const ada = freshName('ada');
    const caller = { subject: ada, cookie: `user:${ada}`, origin: 'https://evil.example' };
    const stream = await target.fetch(
      new Request(
        `${originOf(target, caller)}${target.codec.subscribePath ?? ''}?action=loans.loanEvents`,
        {
          headers: {
            ...Object.fromEntries(requestHeaders(caller)),
            'sec-fetch-site': 'cross-site',
          },
        },
      ),
    );
    expect(stream.status).toBe(403);
    const socket = await target.fetch(
      new Request(`${originOf(target, caller)}/_keelwerk/v1/live`, {
        headers: {
          ...Object.fromEntries(requestHeaders(caller)),
          upgrade: 'websocket',
          'sec-websocket-protocol': 'keelwerk.live.v1',
          'sec-fetch-site': 'cross-site',
        },
      }),
    );
    expect(socket.status).toBe(403);
  });
}
