import {
  defineCommand,
  defineEffect,
  defineEffectExecutor,
  defineProcess,
  defineReaction,
  defineRule,
  errors,
  field,
  setTimer,
  shape,
} from '@keelwerk/core';
import { probeBase } from './erasure-probe-base.ts';

/**
 * A notice whose executor settles with a secret in its output, or refuses with an error that quotes
 * the address: the output is sealed under a value key, the error under the input's subject.
 */
const notice = defineEffect(probeBase, {
  input: shape({ threadId: field.ref.own('thread'), to: field.string().personal() }),
  output: shape({ receipt: field.secret() }),
  dataSubject: 'threadId.ownerId',
});

const noticeExecutor = defineEffectExecutor(probeBase, notice, {
  run: (input) => {
    if (input.to.startsWith('refuse:')) {
      throw errors.validation(`The destination refused ${input.to}`);
    }
    // The kernel seals the plain text of a secret member of an output under a value key.
    return Promise.resolve({ receipt: `receipt for ${input.to}` as never });
  },
});

/** Requests a notice: the executor settles it with an output or an error. */
const notify = defineCommand(probeBase, {
  input: shape({ threadId: field.ref.own('thread'), to: field.string() }),
  principal: 'operator',
  decide: (input) => ({ effects: [notice({ threadId: input.threadId, to: input.to })] }),
});

/**
 * Sets a timer whose job key a module built from a personal value: the key is stored as the
 * module wrote it, which the dump test pins as a known gap.
 */
const remind = defineCommand(probeBase, {
  input: shape({
    threadId: field.ref.own('thread'),
    ownerId: field.subject(),
    address: field.string().personal({ subject: 'ownerId' }),
  }),
  principal: 'operator',
  decide: (input) => ({
    effects: [
      setTimer({
        key: `remind:${input.address}`,
        after: '1h',
        invoke: notify,
        input: { threadId: input.threadId, to: 'neutral' },
      }),
    ],
  }),
});

/**
 * A reaction that refuses every new thread for good, keyed by the topic: its job ends as a dead
 * letter, and the key a module built from a personal value is stored as a hash of it (a known gap).
 */
const refuse = defineReaction(probeBase, {
  on: 'probe.thread.created',
  ordering: 'fifo-per-key',
  key: (event) => String((event.data as { values?: { topic?: string } }).values?.topic ?? 'none'),
  react: (event) => {
    const topic = (event.data as { values?: { topic?: string } }).values?.topic;
    throw errors.validation(`Refused: ${topic ?? 'nothing'}`);
  },
});

/**
 * A process of the thread owner's subject whose decision always fails for good: its job ends as a
 * dead letter of the module's service principal, and holds the instance key (the subject's id)
 * only sealed under the subject's own data key. This is a dead job of another principal that an
 * erasure keeps and can no longer open (D7). A command job ends dead only after three lost leases
 * (a failed attempt with no retries left removes it); the dump test plants that one too, in
 * `erasure-stranded-job.ts`.
 */
const doomed = defineProcess(probeBase, {
  on: ['probe.thread.created'],
  key: (event) => String((event.data as { values?: { ownerId?: string } }).values?.ownerId ?? ''),
  dataSubject: 'instanceKey',
  events: { never: shape({ n: field.integer() }) },
  initial: { count: 0 },
  evolve: (state) => state,
  react: () => {
    throw errors.validation('The process refuses every thread.');
  },
});

const proofRules = {
  notify: defineRule(probeBase, notify, { effect: 'allow', principal: 'operator' }),
  remind: defineRule(probeBase, remind, { effect: 'allow', principal: 'operator' }),
};

export { doomed, notice, noticeExecutor, notify, proofRules, refuse, remind };
