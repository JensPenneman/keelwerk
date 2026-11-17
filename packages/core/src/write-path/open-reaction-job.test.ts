import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openAsyncReaction } from '../reactions/open-async-reaction.ts';
import type { Unit } from '../storage/unit.ts';
import { openReactionJob } from './open-reaction-job.ts';
import type { RunCommandInput } from './run-command-input.ts';

vi.mock('../reactions/open-async-reaction.ts', () => ({
  openAsyncReaction: vi.fn(() => Promise.resolve({})),
}));

const reaction = { id: 'logs.tally', process: true };
const runWith = (over: object): RunCommandInput =>
  ({
    action: { ref: 'logs.tally' },
    registry: { reactions: new Map([['logs.tally', reaction]]) },
    input: { event: 'e-1' },
    build: { id: 'build-1', revision: 1 },
    ...over,
  }) as unknown as RunCommandInput;
const job = { reaction: true } as never;
const unit = {} as unknown as Unit;

/** The build the cache of a process state is bound to, as the fold is handed it. */
async function buildOf(over: object): Promise<unknown> {
  await openReactionJob(unit, runWith(over), job);
  const [call] = vi.mocked(openAsyncReaction).mock.calls.slice(-1);
  return call?.[0].build;
}

describe('the build a reaction job folds its process state with', () => {
  beforeEach(() => vi.mocked(openAsyncReaction).mockClear());

  test('the build id alone, or with the boot nonce of a development run', async () => {
    expect(await buildOf({})).toBe('build-1');
    expect(await buildOf({ bootNonce: 'run-a' })).toBe('build-1:run-a');
    expect(await buildOf({ bootNonce: 'run-b' })).toBe('build-1:run-b');
  });

  test('a job of no reaction opens nothing', async () => {
    expect(await openReactionJob(unit, runWith({}), undefined)).toBeUndefined();
    expect(openAsyncReaction).not.toHaveBeenCalled();
  });
});
