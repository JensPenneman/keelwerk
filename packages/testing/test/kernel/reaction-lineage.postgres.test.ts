import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { StoredEvent } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { loopApp } from './support/loop-module.ts';
import { bootReactions, tenantEventsOf } from './support/reactions-kit.ts';

const maxDepth = 4;
const boundMessage = 'a chain of reactions reached its depth bound and a reaction was not queued';
const lineageOf = (event: StoredEvent) => (event as { lineage?: unknown }).lineage;

const kits: Awaited<ReturnType<typeof bootReactions>>[] = [];
afterAll(async () => {
  await Promise.allSettled(kits.map((kit) => kit.stop()));
});

describe('the depth of a chain of reactions on PostgreSQL', () => {
  test.each(['write', 'enqueue', 'settle'] as const)(
    'a two-reaction loop through %s stops at the bound, and the lineage is stored with the job and the event',
    { timeout: 180_000 },
    async (via) => {
      const database = await createTestDatabase(`reaction_lineage_${via}`);
      const lines: LoggedLine[] = [];
      const kit = await bootReactions({
        app: loopApp,
        maxDepth,
        watched: true,
        logger: recordingLogger(lines),
        external: {
          factory: postgresAdapter({ ownerUrl: database.adminUrl }),
          url: database.appUrl,
        },
      });
      kits.push(kit);
      const started = await kit.call('acme', 'loop.start', { via });
      expect(started.ok).toBe(true);
      await kit.settle();

      const events = (await tenantEventsOf(kit, 'acme')).filter((event) =>
        event.type.startsWith('loop.'),
      );
      const [first, ...chain] = events;
      if (first === undefined) throw new Error('the loop wrote no beat');
      expect(Object.hasOwn(first, 'lineage')).toBe(false);
      expect(chain.map((event) => lineageOf(event))).toEqual(
        [1, 2, 3, 4].map((depth) => ({ depth, origin: first.eventId })),
      );

      const jobs = (kit.spy?.enqueued ?? [])
        .map((one) => one.job)
        .filter((job) => job.queue === 'reactions');
      expect(new Set(jobs.map((job) => job.causation.lineage?.depth))).toEqual(
        new Set([1, 2, 3, 4]),
      );
      expect(jobs.every((job) => job.causation.lineage?.origin === first.eventId)).toBe(true);

      const refused = lines.filter((line) => line.message === boundMessage);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.fields).toMatchObject({
        reaction: 'loop.toPulse',
        origin: first.eventId,
        depth: maxDepth + 1,
      });
      expect((kit.spy?.completions ?? []).filter((one) => one.outcome.kind === 'dead')).toEqual([]);
    },
  );
});
