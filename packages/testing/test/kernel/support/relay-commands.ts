import { defineCommand, enqueue, field, invoke, shape } from '@keelwerk/core';
import { echo, echoOf, forwardRefused, rejected, relayBase, signal } from './relay-base.ts';
import { relayControl } from './relay-control.ts';

/** Writes a signal: the event every reaction below listens to. */
const send = defineCommand(relayBase, {
  input: shape({
    channel: field.string(),
    text: field.string(),
    owner: field.subject(),
    contact: field.string().optional(),
    internalNote: field.string().optional(),
  }),
  output: shape({ signalId: field.ref.own('signal') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(signal);
    return {
      events: [
        ctx.write.relay.signal.create({
          id,
          channel: input.channel,
          text: input.text,
          owner: input.owner,
          ...(input.contact === undefined ? {} : { contact: input.contact }),
          ...(input.internalNote === undefined ? {} : { internalNote: input.internalNote }),
        }),
      ],
      result: { signalId: id },
    };
  },
});

/** Writes several signals of one channel in one command: their events reach the dispatcher in one batch. */
const sendMany = defineCommand(relayBase, {
  input: shape({
    channel: field.string(),
    texts: field.list(field.string()),
    owner: field.subject(),
  }),
  output: shape({ signalIds: field.list(field.string()) }),
  principal: 'user',
  *decide(input, ctx) {
    const ids: string[] = [];
    const events = [];
    for (const text of input.texts) {
      const id = yield* ctx.newId(signal);
      ids.push(id);
      events.push(
        ctx.write.relay.signal.create({ id, channel: input.channel, text, owner: input.owner }),
      );
    }
    return { events, result: { signalIds: ids } };
  },
});

/** Creates a signal and changes its text in the same command: the row at run time differs from the event's data. */
const draft = defineCommand(relayBase, {
  input: shape({ channel: field.string(), owner: field.subject() }),
  output: shape({ signalId: field.ref.own('signal') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(signal);
    return {
      events: [
        ctx.write.relay.signal.create({
          id,
          channel: input.channel,
          text: 'first',
          owner: input.owner,
        }),
        ctx.write.relay.signal.update(id, { text: 'second' }),
      ],
      result: { signalId: id },
    };
  },
});

/** Moves a signal to another owner: the row changes after its event was dispatched. */
const reassign = defineCommand(relayBase, {
  input: shape({ signal: field.ref.own('signal'), owner: field.subject() }),
  principal: 'user',
  decide: (input, ctx) => ({
    events: [ctx.write.relay.signal.update(input.signal, { owner: input.owner })],
  }),
});

/** Writes an echo row for a signal: what the nested reaction invokes. */
const note = defineCommand(relayBase, {
  input: shape({ signal: field.string() }),
  output: shape({}),
  principal: ['user', 'service'],
  *decide(input, ctx) {
    const id = yield* ctx.newId(echo);
    return [
      echoOf(ctx as never, id, { reaction: 'relay.note', channel: 'nested', signal: input.signal }),
    ];
  },
});

/** The action behind the `open` gate: it writes an echo row, so a closed gate leaves none. */
const gatedNote = defineCommand(relayBase, {
  gate: 'open',
  input: shape({ signal: field.string() }),
  output: shape({}),
  principal: ['user', 'service'],
  *decide(input, ctx) {
    const id = yield* ctx.newId(echo);
    return [
      echoOf(ctx as never, id, { reaction: 'relay.gated', channel: 'gated', signal: input.signal }),
    ];
  },
});

/** Always refuses with `relay.rejected`. */
const accept = defineCommand(relayBase, {
  input: shape({ note: field.string() }),
  output: shape({}),
  errors: [rejected],
  principal: ['user', 'service'],
  decide: () => {
    throw rejected();
  },
});

/** Invokes `accept` and maps its refusal to `relay.forward_refused`. */
const forward = defineCommand(relayBase, {
  input: shape({}),
  output: shape({}),
  errors: [forwardRefused],
  principal: 'user',
  decide: () => ({
    events: [],
    effects: [
      invoke(accept, { note: 'x' }, { errors: { 'relay.rejected': 'relay.forward_refused' } }),
    ],
  }),
});

/** Fails with a bug that quotes a value: what an invoked command's internal failure looks like. */
const crash = defineCommand(relayBase, {
  input: shape({}),
  output: shape({}),
  errors: [rejected],
  principal: ['user', 'service'],
  decide: () => {
    if (relayControl.crashPlan !== undefined) {
      relayControl.crashPlan();
      return { events: [] };
    }
    throw new Error('crash detail for ada@example.com');
  },
});

/** Invokes `crash`, mapping only `relay.rejected`: any other failure reaches the caller as the closed projection. */
const delegate = defineCommand(relayBase, {
  input: shape({}),
  output: shape({}),
  errors: [forwardRefused],
  principal: 'user',
  decide: () => ({
    events: [],
    effects: [invoke(crash, {}, { errors: { 'relay.rejected': 'relay.forward_refused' } })],
  }),
});

/** Enqueues `note` under the command id the caller chooses: what any module can do with `enqueue`. */
const claim = defineCommand(relayBase, {
  input: shape({ commandId: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [enqueue(note, { signal: 'claimed' }, { commandId: input.commandId })],
  }),
});

export {
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
};
