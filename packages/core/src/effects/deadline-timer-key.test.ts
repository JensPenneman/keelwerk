import { describe, expect, it } from 'vitest';
import { deadlineTimerKey } from './deadline-timer-key.ts';
import { timerKey } from './timer-key.ts';

describe('deadlineTimerKey', () => {
  it("the kernel's deadline key is core.deadline, a colon and the effect id", () => {
    expect(deadlineTimerKey('eff_1')).toBe('core.deadline:eff_1');
  });

  it("no decision's timer key can equal it, the core module's included", () => {
    const key = deadlineTimerKey('eff_1');
    expect(key).not.toBe(timerKey('core', 'deadline:eff_1'));
    expect(key).not.toBe(timerKey('core', 'eff_1'));
    expect(key.slice(0, key.indexOf(':'))).toContain('.');
  });
});
