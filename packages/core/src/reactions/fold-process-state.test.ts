import { describe, expect, test } from 'vitest';
import {
  noteEvent,
  reactionOf,
  reactionRegistry,
  reactionTenantScope,
} from '../../test/reaction-kit.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { Logger } from '../observability/logger.ts';
import type { Unit } from '../storage/unit.ts';
import { foldProcessState } from './fold-process-state.ts';
import { processStreamRef } from './process-stream-ref.ts';

const tally = reactionOf(reactionRegistry(), 'tally');
const stream = processStreamRef(reactionTenantScope, 'logs.tally', 'note-1');

const recorded = (version: number, name: string, data: unknown): StoredEvent =>
  noteEvent({
    stream,
    version,
    type: `logs.tally.${name}`,
    data,
    hash: `hash-${version}`,
  });

/** A unit whose process stream holds `stored`, read in pages as the store does. */
function unitHolding(stored: readonly StoredEvent[]): Unit {
  return {
    scope: reactionTenantScope,
    events: {
      readStream: (
        ref: { type: string; id: string },
        range?: { fromVersion?: number; limit?: number },
      ) =>
        Promise.resolve(
          ref.id === stream.id
            ? stored
                .filter((event) => event.version >= (range?.fromVersion ?? 1))
                .slice(0, range?.limit ?? stored.length)
            : [],
        ),
    },
  } as unknown as Unit;
}

describe('folding the state of a process instance', () => {
  test('an instance without events is its initial state at version 0', async () => {
    expect(await foldProcessState(unitHolding([]), tally, stream.id, undefined)).toEqual({
      stream,
      subject: undefined,
      state: { count: 0 },
      version: 0,
      lastHash: null,
    });
  });

  test('the events fold in order through evolve, and the last hash is the chain head', async () => {
    const folded = await foldProcessState(
      unitHolding([
        recorded(1, 'noted', { note: 'a', n: 2 }),
        recorded(2, 'noted', { note: 'b', n: 3 }),
      ]),
      tally,
      stream.id,
      undefined,
    );
    expect(folded).toMatchObject({ state: { count: 5 }, version: 2, lastHash: 'hash-2' });
  });

  test('an event the process does not declare is internal', async () => {
    await expect(
      foldProcessState(unitHolding([recorded(1, 'unknown', {})]), tally, stream.id, undefined),
    ).rejects.toMatchObject({ kind: 'internal', code: 'core.internal' });
  });

  test('the instance is the stream the job names: no key is computed, whatever the key function says now', async () => {
    // The process's key function is not consulted: this one would name another instance.
    const moved = { ...tally, key: () => 'another-note' };
    const folded = await foldProcessState(
      unitHolding([recorded(1, 'noted', { note: 'a', n: 2 })]),
      moved,
      stream.id,
      'note-1',
    );
    expect(folded).toMatchObject({ subject: 'note-1', state: { count: 2 }, version: 1 });
    expect(folded.stream).toEqual(stream);
  });

  test('a process without evolve is internal', async () => {
    const { evolve: _unused, ...bare } = tally;
    await expect(
      foldProcessState(unitHolding([]), bare, stream.id, undefined),
    ).rejects.toMatchObject({
      kind: 'internal',
    });
  });

  test('a fold that passes 1,000 events logs one warning and is counted once; 1,000 do not', async () => {
    const lines: { message: string; fields: unknown }[] = [];
    const log = {
      warn: (message: string, fields: unknown) => lines.push({ message, fields }),
    } as unknown as Logger;
    const events = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        recorded(index + 1, 'noted', { note: 'x', n: 1 }),
      );
    await foldProcessState(unitHolding(events(1000)), tally, stream.id, undefined, log);
    expect(lines).toEqual([]);
    const folded = await foldProcessState(
      unitHolding(events(1001)),
      tally,
      stream.id,
      undefined,
      log,
    );
    expect(folded).toMatchObject({ state: { count: 1001 }, version: 1001 });
    expect(lines).toEqual([
      {
        message: 'a process folded a long stream',
        fields: { process: 'logs.tally', events: 1001 },
      },
    ]);
  });
});
