import { defineCommand, defineRule, field, shape } from '@keelwerk/core';
import { probeBase, probeMemo, probeSession } from './erasure-probe-base.ts';

/**
 * A login: nobody is signed in yet, it reads the user agent of the request and writes the session
 * row the subject owns. Its decision record holds the user agent under a key of its own.
 */
const arrive = defineCommand(probeBase, {
  input: shape({ ownerId: field.subject() }),
  output: shape({ sessionId: field.ref.own('session') }),
  principal: 'anonymous',
  *decide(input, ctx) {
    const agent = ctx.request.userAgent;
    const id = yield* ctx.newId(probeSession);
    return {
      events: [
        ctx.write.probe.session.create({
          id,
          ownerId: input.ownerId,
          kind: agent === undefined ? 'unknown' : 'browser',
        }),
      ],
      result: { sessionId: id },
    };
  },
});

/**
 * A note a signed-in user writes: it reads the user agent and writes a row that belongs to no data
 * subject, so no walk from the subject reaches the row or the receipt's principal-less commands.
 */
const note = defineCommand(probeBase, {
  input: shape({ text: field.string({ maxLength: 100 }) }),
  output: shape({ memoId: field.ref.own('memo') }),
  principal: 'user',
  *decide(input, ctx) {
    const agent = ctx.request.userAgent;
    const id = yield* ctx.newId(probeMemo);
    return {
      events: [
        ctx.write.probe.memo.create({ id, text: agent === undefined ? 'none' : input.text }),
      ],
      result: { memoId: id },
    };
  },
});

/**
 * An operator or a service stamps a thread with the user agent of the request: it reads the user
 * agent and writes the thread, so the decision record keeps a request under the long-lived key of
 * the principal's id (`ref.principalId`), whatever row or subject that id stands for. A service's
 * own id (`principal.id`, the actor of its events) can differ from that id.
 */
const stampThread = defineCommand(probeBase, {
  input: shape({ threadId: field.ref.own('thread') }),
  principal: ['operator', 'service'],
  *decide(input, ctx) {
    const agent = ctx.request.userAgent;
    const row = yield* ctx.load.probe.thread.one({ where: { id: input.threadId } });
    if (row === undefined) return [];
    return [
      ctx.write.probe.thread.update(row, { title: agent === undefined ? 'none' : 'stamped' }),
    ];
  },
});

/** The rules of the commands: a login is open to anyone, a note to a signed-in user, a stamp to an operator or a service. */
const requestRules = {
  stampThread: defineRule(probeBase, stampThread, {
    effect: 'allow',
    principal: ['operator', 'service'],
  }),
  arrive: defineRule(probeBase, arrive, { effect: 'allow', principal: 'anonymous' }),
  note: defineRule(probeBase, note, { effect: 'allow', principal: 'user' }),
};

export { arrive, note, requestRules, stampThread };
