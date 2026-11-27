import { afterEach, describe, expect, test, vi } from 'vitest';
import { scheduleUnitOptions } from './schedule-unit-options.ts';

// The limit of a unit is fired by hand: `AbortSignal.timeout` is replaced by a signal the case
// aborts, so no case waits for time to pass.

const timeoutError = (): DOMException =>
  new DOMException('The operation was aborted due to timeout', 'TimeoutError');

function withInjectedTimeout(): AbortController {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  return timeout;
}

describe('scheduleUnitOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a unit past its limit is aborted with core.unavailable, the time-out as its cause', () => {
    const timeout = withInjectedTimeout();
    const options = scheduleUnitOptions(
      { abandon: new AbortController() },
      { unitTimeoutMs: 10_000 },
    );
    expect(options.timeoutMs).toBe(10_000);
    expect(options.signal.aborted).toBe(false);
    const reason = timeoutError();
    timeout.abort(reason);
    expect(options.signal.reason).toMatchObject({ code: 'core.unavailable', cause: reason });
  });

  test('a unit abandoned at the stop deadline keeps the error of the abandon as its reason', () => {
    const timeout = withInjectedTimeout();
    const abandon = new AbortController();
    const options = scheduleUnitOptions({ abandon }, { unitTimeoutMs: 10_000 });
    const stopped = new Error('abandoned at the stop deadline');
    abandon.abort(stopped);
    timeout.abort(timeoutError());
    expect(options.signal.reason).toBe(stopped);
  });
});
