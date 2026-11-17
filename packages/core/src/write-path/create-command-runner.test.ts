import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CommandRun } from '../invoker/command-runner.ts';
import { openAsyncReaction } from '../reactions/open-async-reaction.ts';
import type { Unit } from '../storage/unit.ts';
import { createCommandRunner } from './create-command-runner.ts';
import { openReactionJob } from './open-reaction-job.ts';
import { runCommand } from './run-command.ts';

vi.mock('./run-command.ts', () => ({ runCommand: vi.fn(() => Promise.resolve({ output: {} })) }));
vi.mock('../reactions/open-async-reaction.ts', () => ({
  openAsyncReaction: vi.fn(() => Promise.resolve({})),
}));

const job = { reaction: true, signal: new AbortController().signal } as never;

/** A command run of a reaction job, as the execute stage hands it over. */
const runOf = (over: object): CommandRun =>
  ({
    action: { ref: 'logs.tally', kind: 'command', execution: 'sync' },
    registry: { reactions: new Map([['logs.tally', { id: 'logs.tally', process: true }]]) },
    input: { event: 'e-1' },
    invocation: { requestId: 'req-1', carrier: { job } },
    session: { principal: {}, apiVersion: '1', app: 'logs' },
    target: { handle: { adapter: {} }, namespace: {}, scope: {} },
    build: { id: 'build-1', revision: 1 },
    signal: new AbortController().signal,
    ...over,
  }) as unknown as CommandRun;

/** The build id the fold of a reaction job's process state is bound to, from what the runner passed on. */
async function foldBuildOf(over: object): Promise<unknown> {
  await createCommandRunner({ deploymentId: 'dep-1', behaviours: () => ({}) as never })(
    runOf(over),
  );
  const [input] = vi
    .mocked(runCommand)
    .mock.calls.slice(-1)
    .map(([passed]) => passed);
  if (input === undefined) throw new Error('the runner did not run the command');
  await openReactionJob({} as unknown as Unit, input, job);
  const [call] = vi.mocked(openAsyncReaction).mock.calls.slice(-1);
  return call?.[0].build;
}

describe('the boot nonce the command runner passes on', () => {
  beforeEach(() => {
    vi.mocked(runCommand).mockClear();
    vi.mocked(openAsyncReaction).mockClear();
  });

  test('a reaction job of a development run folds with the build id and the nonce of the run', async () => {
    expect(await foldBuildOf({ bootNonce: 'run-a' })).toBe('build-1:run-a');
    expect(vi.mocked(runCommand).mock.calls.at(-1)?.[0].bootNonce).toBe('run-a');
  });

  test('a run without a nonce folds with the build id alone', async () => {
    expect(await foldBuildOf({})).toBe('build-1');
    expect(vi.mocked(runCommand).mock.calls.at(-1)?.[0]).not.toHaveProperty('bootNonce');
  });
});
