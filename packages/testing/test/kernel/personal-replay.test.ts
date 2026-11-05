import { describe, expect, test } from 'vitest';
import { runInMemory } from '../../src/drive/run-in-memory.ts';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { peopleApp } from './support/personal-kit.ts';
import { ada } from './support/runtime-kit.ts';

const text = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    member instanceof Uint8Array
      ? Buffer.from(member).toString('hex')
      : typeof member === 'bigint'
        ? member.toString()
        : member,
  );

describe('personal fields through the drive and replay helpers (14.7.4, S-82)', () => {
  test('seeded rows are sealed, the run reads them back plain, and the command re-decides to its record', async () => {
    const input = {
      name: 'Grace',
      email: 'Grace@Replay.example.org',
      notes: 'a private replay note',
    };
    const run = await runInMemory(peopleApp, 'people.enrol', {
      input,
      principal: ada,
      rows: {
        'people.person': [
          { name: 'Seed', email: 'seed.person@example.org', notes: 'a seeded private note' },
        ],
      },
    });
    try {
      expect(run.outcome.ok).toBe(true);
      // The helper reads through the sealing layer: values are plain, tags absent.
      const rows = await run.rows('people.person');
      expect(rows.map((row) => row.email).sort()).toEqual([
        'Grace@Replay.example.org',
        'seed.person@example.org',
      ]);
      expect(rows.every((row) => !('email__eq' in row))).toBe(true);
      // The events as stored hold no plaintext personal value.
      expect(text(run.events)).not.toMatch(/seed\.person|private replay note|Replay\.example/);
      // The re-decision compares the personal values by value, not by presence.
      const result = await expectReproduces(run.runtime, { commandId: run.commandId, input });
      expect(result.reproduced).toBe(true);
      const wrong = await expectReproduces(run.runtime, {
        commandId: run.commandId,
        input: { ...input, email: 'someone.else@example.org' },
      }).then(
        () => 'reproduced',
        (error: unknown) => (error instanceof Error ? error.message : 'failed'),
      );
      expect(wrong).not.toBe('reproduced');
    } finally {
      await run.stop();
    }
  });
});
