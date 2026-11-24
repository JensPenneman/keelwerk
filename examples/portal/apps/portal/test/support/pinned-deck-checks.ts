import { expect } from 'vitest';
import { deckVersions } from './pinned-deck-app.ts';
import type { Inbox, PinnedDeck } from './pinned-deck-kit.ts';

const { older, head } = deckVersions;
let counter = 0;

/** The member that holds a card's title: the breaking change renamed it between the two versions. */
export const memberAt = (version: string): 'name' | 'title' =>
  version === older ? 'name' : 'title';

/** The card as the client at `version` sees it: its title under that version's member and under no other. */
export function expectCardAt(version: string, card: unknown, title: string): void {
  const member = memberAt(version);
  expect(card).toMatchObject({ [member]: title });
  expect(card).not.toHaveProperty(member === 'name' ? 'title' : 'name');
}

/** A title no other case used, so a case finds its own card among the rows. */
export const titleOf = (label: string): string => `${label}-${++counter}`;

/** Whether a stream item or a row holds the card with this title, whichever member the version calls it. */
export const holds =
  (title: string) =>
  (item: unknown): boolean =>
    JSON.stringify(item).includes(`"${title}"`);

/** The row of a card in a list answer, in whatever list shape the transport answers. */
export function listedCard(list: unknown, title: string): unknown {
  expect(JSON.stringify(list)).toContain(`"${title}"`);
  const shape = list as { items?: unknown[]; nodes?: unknown[] };
  return (shape.items ?? shape.nodes ?? []).find(holds(title));
}

/** Whether a stream item is the head the stream opens with: the subscription is live from it on. */
export const isHead = (item: unknown): boolean => /"head"|StreamHead/.test(JSON.stringify(item));

/** The card row of a stream item, wherever the transport nests it. */
export function rowOf(item: unknown): unknown {
  if (typeof item !== 'object' || item === null) return undefined;
  if ('row' in item) return item.row;
  for (const member of Object.values(item)) {
    const found = rowOf(member);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The member at a path of nested objects; undefined where the path ends early. */
export function pick(value: unknown, ...path: string[]): unknown {
  let at = value;
  for (const name of path) {
    if (typeof at !== 'object' || at === null) return undefined;
    at = (at as Record<string, unknown>)[name];
  }
  return at;
}

export const json = (response: Response): Promise<unknown> => response.json();

/** The first item of an iterator that `test` passes; the iterator ending first fails the case. */
export async function nextWhere<T>(
  frames: AsyncIterator<T>,
  test: (item: T) => boolean,
): Promise<T> {
  for (;;) {
    const step = await frames.next();
    if (step.done === true) throw new Error('The stream ended before the item arrived.');
    if (test(step.value)) return step.value;
  }
}

/** One client of a transport at one version: a command and a query in the form that version has. */
export interface VersionClient {
  create(title: string): Promise<unknown>;
  list(): Promise<unknown>;
}

/**
 * A command and a query at both versions: each client writes a card under its own member and reads
 * it back; then each client reads the card the other one wrote, under its own member.
 */
export async function proveCommandsAndQueries(
  label: string,
  clientAt: (version: string) => VersionClient,
): Promise<void> {
  const written: string[] = [];
  for (const version of [older, head]) {
    const title = titleOf(label);
    expectCardAt(version, await clientAt(version).create(title), title);
    written.push(title);
  }
  for (const version of [older, head]) {
    const listed = await clientAt(version).list();
    for (const title of written) expectCardAt(version, listedCard(listed, title), title);
  }
}

/** Feeds what an async iterable yields into an inbox; the iterable failing or ending ends the feed. */
export function pump(
  source: AsyncIterable<unknown> | AsyncIterator<unknown>,
  into: Inbox<unknown>,
): void {
  const iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source;
  void (async () => {
    for (let step = await iterator.next(); step.done !== true; step = await iterator.next()) {
      into.push(step.value);
    }
  })().catch(() => undefined);
}

/** What a reopen case lets the proof drive. */
export interface ReopenSteps {
  readonly deck: PinnedDeck;
  readonly label: string;
  /** Every item the subscription delivers, heads included, as it arrives; the stream has delivered its first head. */
  readonly items: Inbox<unknown>;
  /** Told each card item the proof reads, for the token the reopen needs. */
  readonly onCard?: (item: unknown) => void;
  /** Ends the connection and settles once it has ended. */
  cut(): Promise<void>;
  /** Lets the client connect again. */
  reopen(): void | Promise<void>;
}

/**
 * A subscription pinned to the older version across a reopen: the first card arrives, the connection
 * is cut, the second card is created while none is open, the reopen is let through, and the third
 * card is created once the reopened stream is live (its head follows the replay). The next item must
 * be the second card, brought by the stream token, and the one after it the third. A reopen that
 * ignores the token, or serves the head, fails on the item the case reads, not on a time limit.
 */
export async function proveReopen(steps: ReopenSteps): Promise<void> {
  const [first, second, third] = ['first', 'second', 'third'].map((name) =>
    titleOf(`${steps.label}-${name}`),
  ) as [string, string, string];
  const card = async (): Promise<unknown> => {
    const item = await steps.items.next(isHead);
    steps.onCard?.(item);
    return rowOf(item);
  };
  await steps.items.reach(1, isHead);
  await steps.deck.create(first);
  expectCardAt(older, await card(), first);
  await steps.cut();
  await steps.deck.create(second);
  await steps.reopen();
  await steps.items.reach(2, isHead);
  await steps.deck.create(third);
  expectCardAt(older, await card(), second);
  expectCardAt(older, await card(), third);
}

/**
 * What a socket meets after the messages it sends on opening: the close it is given (`reason` is the
 * error code) or the first message the server sends (`reason` starts with `message`), which holds
 * the error code when the server refuses in a frame before it closes.
 */
export function closeAfter(
  deck: PinnedDeck,
  url: string,
  protocol: string,
  ...messages: unknown[]
): Promise<{ readonly code: number; readonly reason: string }> {
  const socket = new WebSocket(url, { protocols: [protocol], headers: deck.principal } as never);
  return new Promise((settled, failed) => {
    socket.addEventListener('open', () => {
      for (const message of messages) socket.send(JSON.stringify(message));
    });
    socket.addEventListener('message', (event) => {
      // The protocol's own socket welcomes a client before it hears from it.
      if (String(event.data).includes('"welcome"')) return;
      settled({ code: 0, reason: `message ${String(event.data)}` });
      socket.close();
    });
    socket.addEventListener('close', (event) =>
      settled({ code: event.code, reason: event.reason }),
    );
    socket.addEventListener('error', () => failed(new Error('The upgrade was refused.')));
  });
}
