import type { Logger } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { BoardKit } from './support/live-kit.ts';
import { people, startBoard } from './support/live-kit.ts';

const canary = 'CANARY-7f3a91';

describe('what the live hub logs', () => {
  const lines: string[] = [];
  let kit: BoardKit;
  beforeAll(async () => {
    const write =
      (level: string) => (message: string, fields?: Readonly<Record<string, unknown>>) => {
        lines.push(
          `${level} ${message} ${JSON.stringify(fields ?? {}, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`,
        );
      };
    const log: Logger = {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
      child: () => log,
    };
    kit = await startBoard('memory', undefined, log);
  });
  afterAll(async () => {
    await kit.stop();
  });

  test('no hub log line carries a row or filter value', async () => {
    const stream = kit.subscribe(kit.acme, people.ada, { from: 'beginning', shownOnly: true });
    const resumed = kit.subscribe(kit.acme, people.vic, { from: 'beginning' });
    try {
      await stream.ready();
      await resumed.ready();
      const made = await kit.write<{ id: string }>(kit.acme, 'board.card.create', {
        owner: 'ada',
        title: canary,
        note: canary,
      });
      await kit.write(kit.acme, 'board.card.update', {
        id: made.id,
        patch: { title: `${canary}-2`, shown: false },
      });
      await stream.until((frames) => frames.filter((frame) => 'event' in frame).length >= 2);
      expect(JSON.stringify(stream.frames)).toContain(canary);
    } finally {
      await stream.stop();
      await resumed.stop();
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((line) => line.includes(canary))).toEqual([]);
  });
});
