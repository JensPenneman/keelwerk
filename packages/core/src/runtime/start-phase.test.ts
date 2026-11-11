import { afterEach, describe, expect, test, vi } from 'vitest';
import { startPhase } from './start-phase.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

const phases = vi.hoisted(() => ({
  list: [] as ((input: unknown) => (deadline: AbortSignal) => Promise<void>)[],
}));

vi.mock('./m2-phases.ts', () => ({
  get m2Phases() {
    return phases.list;
  },
}));

const warnings: string[] = [];
const input = {
  connected: {
    control: {},
    processId: 'p-1',
    log: { warn: (message: string) => warnings.push(message) },
  },
  migrated: { directory: { follow: () => new Promise<void>(() => undefined) } },
  options: { role: 'all', listen: false },
} as unknown as StartPhaseInput;

afterEach(() => {
  vi.useRealTimers();
  phases.list = [];
  warnings.length = 0;
});

describe('startPhase with a phase that throws synchronously', () => {
  test('stops the phases already started, leaves no timer and rethrows', async () => {
    vi.useFakeTimers();
    const stopped: AbortSignal[] = [];
    phases.list = [
      () => async (deadline) => {
        stopped.push(deadline);
      },
      () => {
        throw new Error('the second phase cannot start');
      },
    ];
    expect(() => startPhase(input)).toThrow('the second phase cannot start');
    expect(vi.getTimerCount()).toBe(0);
    await vi.waitFor(() => expect(stopped).toHaveLength(1));
    expect(stopped[0]?.aborted).toBe(true);
  });

  test('without a failing phase the heartbeat runs and the phases stop with the deadline', async () => {
    vi.useFakeTimers();
    const stopped: AbortSignal[] = [];
    phases.list = [
      () => async (deadline) => {
        stopped.push(deadline);
      },
    ];
    const started = startPhase(input);
    expect(vi.getTimerCount()).toBe(1);
    await started.stopPhases(AbortSignal.timeout(1000));
    expect(stopped).toHaveLength(1);
    started.unfollow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
