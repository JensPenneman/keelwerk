import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { checkExecutorInputReads } from './check-executor-input-reads.ts';
import type { EffectEntry } from './effect-entry.ts';
import type { ExecutorEntry } from './executor-entry.ts';

const effects: ReadonlyMap<string, EffectEntry> = new Map([
  [
    'courier.deliver',
    {
      ref: 'courier.deliver',
      module: 'courier',
      name: 'deliver',
      performer: 'executor',
      executor: 'courier.deliver',
      input: shape({
        owner: field.subject(),
        url: field.string(),
        to: field.string().personal({ subject: 'owner' }),
      }),
      output: shape({}),
    },
  ],
]);

function executors(options: Partial<ExecutorEntry>): ReadonlyMap<string, ExecutorEntry> {
  return new Map([
    [
      'courier.deliver',
      {
        ref: 'courier.deliver',
        module: 'courier',
        effect: 'courier.deliver',
        queue: 'effects',
        capability: [],
        inline: false,
        run: () => Promise.resolve({}),
        ...options,
      },
    ],
  ]);
}

describe('checkExecutorInputReads', () => {
  test('a group that reads a personal member is executorReadsPersonal', () => {
    const problems = checkExecutorInputReads(
      effects,
      executors({
        group: ({ input }) => ({ id: String((input as { to: string }).to), concurrency: 1 }),
      }),
    );
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'executorReadsPersonal',
        severity: 'error',
        module: 'courier',
        ref: 'courier.deliver',
        message: expect.stringContaining('"to"'),
      }),
    ]);
  });

  test('a capabilityOf that reads a personal member is refused too', () => {
    const problems = checkExecutorInputReads(
      effects,
      executors({
        capabilityOf: ({ input }) => ((input as { to: string }).to ? ['smtp-out'] : []),
      }),
    );
    expect(problems.map((problem) => problem.code)).toEqual(['executorReadsPersonal']);
    expect(problems[0]?.message).toContain('capabilityOf');
  });

  test('a group by a member that is not personal passes, also when it throws on the probe', () => {
    expect(
      checkExecutorInputReads(
        effects,
        executors({
          group: ({ input }) => ({
            id: `host:${new URL((input as { url: string }).url).host}`,
            concurrency: 2,
          }),
        }),
      ),
    ).toEqual([]);
  });

  test('a group that reads a personal member and then throws is still found', () => {
    const problems = checkExecutorInputReads(
      effects,
      executors({
        group: ({ input }) => {
          const to = (input as { to: string }).to;
          throw new Error(`no ${to}`);
        },
      }),
    );
    expect(problems).toHaveLength(1);
  });

  test('an executor with neither option has no problem', () => {
    expect(checkExecutorInputReads(effects, executors({}))).toEqual([]);
  });
});
