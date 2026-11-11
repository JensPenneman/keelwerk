import { defineProcess, defineReaction, errors, field, invoke, shape } from '@keelwerk/core';
import { channelOf, echo, echoOf, relayBase } from './relay-base.ts';
import { gatedNote, note } from './relay-commands.ts';
import { relayControl } from './relay-control.ts';

/** An async reaction that answers every signal with an echo row. */
const echoReaction = defineReaction(relayBase, {
  on: 'relay.signal.created',
  *react(event, ctx) {
    relayControl.decided.push(`relay.echo:${event.stream.id}`);
    const id = yield* ctx.newId(echo);
    return [
      echoOf(ctx as never, id, {
        reaction: 'relay.echo',
        channel: channelOf(event as never),
        signal: event.stream.id,
        seenText: String((event.current as { text?: string } | undefined)?.text ?? 'gone'),
      }),
    ];
  },
});

/** Fails with `unavailable` on the channel `down` until it was attempted three times; retries with its own delays. */
const flaky = defineReaction(relayBase, {
  on: 'relay.signal.created',
  retry: { limit: 5, delays: ['10s', '20s', '40s'] },
  *react(event, ctx) {
    const channel = channelOf(event as never);
    relayControl.decided.push(`relay.flaky:${event.stream.id}`);
    const tried = (relayControl.attempts.get(event.id) ?? 0) + 1;
    relayControl.attempts.set(event.id, tried);
    if (channel === 'down' && tried <= 3) throw errors.unavailable('The destination is down.');
    const id = yield* ctx.newId(echo);
    return [
      echoOf(ctx as never, id, {
        reaction: 'relay.flaky',
        channel,
        signal: event.stream.id,
        count: tried,
      }),
    ];
  },
});

/** One at a time per channel, in event order. */
const ordered = defineReaction(relayBase, {
  on: 'relay.signal.created',
  ordering: 'fifo-per-key',
  key: (event) => {
    const channel = channelOf(event as never);
    if (relayControl.poison.has(channel)) throw errors.internal(`poisoned ${channel}`);
    return channel;
  },
  *react(event, ctx) {
    relayControl.decided.push(`relay.ordered:${event.stream.id}`);
    const text = String((event.data as { values: { text: string } }).values.text);
    // A text of `bad` is refused for good, with a message that repeats a personal value.
    if (text === 'bad' && !relayControl.fixed) throw errors.validation('Refused: ada@example.com');
    const id = yield* ctx.newId(echo);
    return [
      echoOf(ctx as never, id, {
        reaction: 'relay.ordered',
        channel: channelOf(event as never),
        signal: event.stream.id,
      }),
    ];
  },
});

/** A newer signal of a channel replaces the pending job of an older one. */
const latest = defineReaction(relayBase, {
  on: 'relay.signal.created',
  coalesce: true,
  key: (event) => channelOf(event as never),
  *react(event, ctx) {
    relayControl.decided.push(`relay.latest:${event.stream.id}`);
    const id = yield* ctx.newId(echo);
    return [
      echoOf(ctx as never, id, {
        reaction: 'relay.latest',
        channel: channelOf(event as never),
        signal: event.stream.id,
      }),
    ];
  },
});

/** Invokes the command `relay.note` for each signal: the nested command is caused by the event. */
const nested = defineReaction(relayBase, {
  on: 'relay.signal.created',
  react: (event) => ({ events: [], effects: [invoke(note, { signal: event.stream.id })] }),
});

/** Fails once with `unavailable`, and then invokes the gated command: the retry takes a flag snapshot of its own. */
const gated = defineReaction(relayBase, {
  on: 'relay.signal.created',
  retry: { limit: 3, delays: ['10s'] },
  react: (event) => {
    const tried = (relayControl.attempts.get(`gated:${event.id}`) ?? 0) + 1;
    relayControl.attempts.set(`gated:${event.id}`, tried);
    if (tried === 1) throw errors.unavailable('Not yet.');
    return { events: [], effects: [invoke(gatedNote, { signal: event.stream.id })] };
  },
});

/**
 * Counts the signals of each owner in a state stream of its own, and keeps the contact as a personal
 * note. Its key reads `current` when it is given one, as a process that does not mind its type would:
 * the kernel gives a process key no `current`, so the instance cannot move with the row.
 */
const tally = defineProcess(relayBase, {
  on: ['relay.signal.created'],
  key: (event) =>
    relayControl.tallyKey ??
    String(
      (event as unknown as { current?: { owner?: string } }).current?.owner ??
        (event.data as { values: { owner: string } }).values.owner,
    ),
  dataSubject: 'instanceKey',
  events: { noted: shape({ note: field.string().personal(), n: field.integer() }) },
  initial: { count: 0, notes: [] as readonly string[] },
  evolve: (state, event) => ({
    count: state.count + event.data.n,
    notes: [...state.notes, (event.data as { note?: string }).note ?? '(gone)'],
  }),
  *react(event, state, ctx) {
    const id = yield* ctx.newId(echo);
    const values = (event.data as { values: { contact?: string; channel: string } }).values;
    return [
      ctx.events.noted({ note: values.contact ?? 'none', n: 1 }),
      echoOf(ctx as never, id, {
        reaction: 'relay.tally',
        channel: values.channel,
        signal: event.stream.id,
        count: state.count,
        // The length of each note seen so far, never the note: the echo row is plain data.
        seenText: state.notes.map((note) => String(note.length)).join(','),
      }),
    ];
  },
});

export { echoReaction, flaky, gated, latest, nested, ordered, tally };
