import { expect, test } from 'vitest';
import type { Caller } from './call.ts';
import { freshName } from './fresh-name.ts';
import { heldSessionCases } from './held-session-cases.ts';
import { lendCall } from './lend-call.ts';
import { lendTitles } from './lend-titles.ts';
import { liveSocketCases } from './live-socket-cases.ts';
import { originOf } from './origin-of.ts';
import { requestHeaders } from './request-headers.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

const tokenShape = /^v2\.[0-9a-z.]+$/;

/**
 * The scenarios of the live stream (15.4.4 to 15.4.6, 16.4.10), against the protocol's
 * `/_keelwerk/v1/subscribe` and the conformance app's `loans.loanEvents` subscription. They run only
 * for a codec with a stream endpoint and a deployment that runs the live module.
 */
export function subscriptionCases(target: TransportTarget): void {
  const { codec } = target;
  const open = (over: Parameters<NonNullable<typeof codec.subscribe>>[1]) => {
    if (codec.subscribe === undefined) throw new Error('The codec has no stream endpoint.');
    return codec.subscribe(target, over);
  };
  const skip = codec.subscribe === undefined || target.live !== true;

  test.skipIf(skip)('opens with welcome and head, then streams the loans that change', async () => {
    const ada = freshName('ada');
    const stream = await open({ action: 'loans.loanEvents', input: {}, caller: { subject: ada } });
    try {
      expect(stream.response.status).toBe(200);
      expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
      if (codec.streamWelcome !== false) {
        const welcome = await stream.next();
        expect(welcome?.event).toBe('welcome');
        expect(welcome?.data).toMatchObject({ protocol: 1 });
      }
      const head = await stream.next();
      expect(head?.event).toBe('head');
      const state = (head?.data as { state?: string } | undefined)?.state;
      expect(state).toMatch(tokenShape);
      expect(head?.id).toBe(state);
      await sendCall(target, lendCall(ada, freshName('Dune')));
      const item = await stream.next();
      expect(item?.event).toBe('data');
      expect(item?.id).toMatch(tokenShape);
      expect(item?.data).toMatchObject({ kind: 'created' });
      expect((item?.data as { loanId?: string } | undefined)?.loanId).toMatch(
        /^loan_[0-9a-z]{26}$/,
      );
    } finally {
      await stream.close();
    }
  });

  test.skipIf(skip)('resumes after the last token it saw', async () => {
    const ada = freshName('ada');
    const first = await open({ action: 'loans.loanEvents', input: {}, caller: { subject: ada } });
    let seen: string | undefined;
    let firstLoan: string | undefined;
    try {
      await first.until((frame) => frame.event === 'head');
      await sendCall(target, lendCall(ada, freshName('Emma')));
      const item = await first.next();
      seen = item?.id;
      firstLoan = (item?.data as { loanId?: string } | undefined)?.loanId;
    } finally {
      await first.close();
    }
    expect(seen).toMatch(tokenShape);
    await sendCall(target, lendCall(ada, freshName('Hamlet')));
    const resumed = await open({
      action: 'loans.loanEvents',
      input: {},
      caller: { subject: ada },
      ...(seen === undefined ? {} : { lastEventId: seen }),
    });
    try {
      const frames = await resumed.until((frame) => frame.event === 'head');
      const loans = frames
        .filter((frame) => frame.event === 'data')
        .map((frame) => (frame.data as { loanId: string }).loanId);
      expect(loans).toHaveLength(1);
      expect(loans).not.toContain(firstLoan);
      expect(frames.at(-1)?.event).toBe('head');
    } finally {
      await resumed.close();
    }
  });

  test.skipIf(skip)(
    'a v1 token answers reset resync as the last frame, a malformed one 400',
    async () => {
      const ada = freshName('ada');
      // The v1 form of the token of this scope: the old format with its short check.
      const head = await open({ action: 'loans.loanEvents', input: {}, caller: { subject: ada } });
      let current: string | undefined;
      try {
        const frames = await head.until((frame) => frame.event === 'head');
        current = (frames.at(-1)?.data as { state?: string } | undefined)?.state;
      } finally {
        await head.close();
      }
      const [, epoch, position, scope, check] = (current ?? '').split('.');
      const old = await open({
        action: 'loans.loanEvents',
        input: {},
        caller: { subject: ada },
        lastEventId: `v1.${epoch}.${position}.${scope}.${check?.slice(0, 8)}`,
      });
      try {
        const frames = await old.until(
          (frame) => frame.event === 'reset' || frame.event === 'error',
        );
        // A reset is the last frame of its stream: no id line (the client keeps the position it holds), no end frame, and the body ends.
        expect(frames.at(-1)).toMatchObject({ event: 'reset', data: { reason: 'resync' } });
        expect(frames.at(-1)?.id).toBeUndefined();
        expect(await old.next()).toBeUndefined();
      } finally {
        await old.close();
      }
      const malformed = await open({
        action: 'loans.loanEvents',
        input: {},
        caller: { subject: ada },
        after: 'NOT A TOKEN!',
      });
      expect(malformed.response.status).toBe(400);
      await malformed.close();
      // The characters of a token, but not its form: the stream does not start.
      const unreadable = await open({
        action: 'loans.loanEvents',
        input: {},
        caller: { subject: ada },
        after: 'v2.zz',
      });
      expect(unreadable.response.status).toBe(400);
      await unreadable.close();
    },
  );

  test.skipIf(skip)('a cross-site page cannot open the stream with the user’s cookie', async () => {
    const ada = freshName('ada');
    const caller = { subject: ada, cookie: `user:${ada}`, origin: 'https://evil.example' };
    const stream = await target.fetch(
      new Request(
        `${originOf(target, caller)}${codec.subscribePath ?? ''}?action=loans.loanEvents`,
        {
          headers: {
            ...Object.fromEntries(requestHeaders(caller)),
            'sec-fetch-site': 'cross-site',
            accept: 'text/event-stream',
          },
        },
      ),
    );
    expect(stream.status).toBe(403);
  });

  test.skipIf(skip)(
    'anonymous streams are capped per client address: one address runs out, another does not',
    async () => {
      const stream = (remoteAddress: string) =>
        open({ action: 'loans.loanTicker', input: {}, remoteAddress });
      const held: Awaited<ReturnType<typeof stream>>[] = [];
      try {
        // The cap of the host: streams of one anonymous client address.
        let refused: Awaited<ReturnType<typeof stream>> | undefined;
        for (
          let index = 0;
          index < 2 * target.bounds.maxStreamsPerPrincipal && refused === undefined;
          index += 1
        ) {
          const next = await stream('203.0.113.50');
          if (next.response.status === 200) held.push(next);
          else refused = next;
        }
        expect(held).toHaveLength(target.bounds.maxStreamsPerPrincipal);
        expect(refused?.response.status).toBe(429);
        await refused?.close();
        const other = await stream('203.0.113.51');
        held.push(other);
        expect(other.response.status).toBe(200);
      } finally {
        await Promise.all(held.map((entry) => entry.close()));
      }
    },
  );

  // Lends its titles once per deployment, in the first tenant (the socket case lends in the second);
  // every runner boots its own deployment, so a second run on one deployment fails at once on the lend.
  test.skipIf(skip)(
    'an item whose event has its own member control is an item for every subscriber: nobody resets and no stream ends',
    async () => {
      const tenant = Object.keys(target.tenants)[0];
      const [adaName, bobName] = [freshName('ada'), freshName('bob')];
      const caller = (subject: string): Caller => ({
        subject,
        roles: ['auditor'],
        ...(tenant === undefined ? {} : { tenant }),
      });
      const ada = await open({ action: 'loans.loanTitles', input: {}, caller: caller(adaName) });
      const bob = await open({ action: 'loans.loanTitles', input: {}, caller: caller(bobName) });
      try {
        await ada.until((frame) => frame.event === 'head', 30_000);
        await bob.until((frame) => frame.event === 'head', 30_000);
        const controls = ['reset', 'head', 'gap', 'later'];
        await lendTitles(target, adaName, caller(adaName), controls);
        for (const stream of [ada, bob]) {
          const frames = await stream.until(
            (frame) => (frame.data as { control?: string } | undefined)?.control === 'later',
            30_000,
          );
          expect(frames.map((frame) => frame.event)).toEqual(['data', 'data', 'data', 'data']);
          expect(frames.map((frame) => (frame.data as { control: string }).control)).toEqual(
            controls,
          );
        }
      } finally {
        await Promise.all([ada.close(), bob.close()]);
      }
    },
    120_000,
  );

  liveSocketCases(target);
  heldSessionCases(target);
}
