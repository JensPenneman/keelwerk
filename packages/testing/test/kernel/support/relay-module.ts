import { defineModule, defineRule, type ModuleType } from '@keelwerk/core';
import { echo, relayBase, signal } from './relay-base.ts';
import {
  accept,
  claim,
  crash,
  delegate,
  draft,
  forward,
  gatedNote,
  note,
  reassign,
  send,
  sendMany,
} from './relay-commands.ts';
import { echoReaction, flaky, gated, latest, nested, ordered, tally } from './relay-reactions.ts';

const relayDef = defineModule(relayBase, {
  actions: {
    send,
    sendMany,
    draft,
    note,
    gatedNote,
    accept,
    forward,
    claim,
    reassign,
    crash,
    delegate,
  },
  policies: {
    send: { signedIn: defineRule(relayBase, send, { effect: 'allow', principal: 'user' }) },
    sendMany: { signedIn: defineRule(relayBase, sendMany, { effect: 'allow', principal: 'user' }) },
    draft: { signedIn: defineRule(relayBase, draft, { effect: 'allow', principal: 'user' }) },
    note: { signedIn: defineRule(relayBase, note, { effect: 'allow', principal: 'user' }) },
    gatedNote: {
      signedIn: defineRule(relayBase, gatedNote, { effect: 'allow', principal: 'user' }),
    },
    accept: { signedIn: defineRule(relayBase, accept, { effect: 'allow', principal: 'user' }) },
    forward: { signedIn: defineRule(relayBase, forward, { effect: 'allow', principal: 'user' }) },
    claim: { signedIn: defineRule(relayBase, claim, { effect: 'allow', principal: 'user' }) },
    crash: { signedIn: defineRule(relayBase, crash, { effect: 'allow', principal: 'user' }) },
    delegate: {
      signedIn: defineRule(relayBase, delegate, { effect: 'allow', principal: 'user' }),
    },
    reassign: {
      signedIn: defineRule(relayBase, reassign, { effect: 'allow', principal: 'user' }),
    },
    signal: {
      readers: defineRule(relayBase, signal, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        reason: 'A signed-in user reads every signal.',
      }),
    },
    echo: {
      readers: defineRule(relayBase, echo, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        reason: 'A signed-in user reads every echo.',
      }),
    },
  },
  reactions: { echo: echoReaction, flaky, ordered, latest, nested, gated, tally },
});
interface Relay extends ModuleType<typeof relayDef> {}
/** The relay module: signals, the reactions that answer them, the process that tallies them and the commands around them. */
export const relay: Relay = relayDef;
