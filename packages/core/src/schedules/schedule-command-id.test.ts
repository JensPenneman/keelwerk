import { describe, expect, test } from 'vitest';
import { isKernelCommandId } from '../ids/is-kernel-command-id.ts';
import { scheduleCommandId } from './schedule-command-id.ts';

describe('the command id of a tick', () => {
  const id = scheduleCommandId(
    'ticker.everyTenant',
    '00000000-0000-4000-8000-0000000000a1',
    300_000,
    Temporal.Instant.from('2026-01-01T00:05:00Z'),
  );

  test('the tick id is final', () => {
    expect(id).toBe(
      'kernel:schedule:ticker.everyTenant:00000000-0000-4000-8000-0000000000a1:300000:1767225900000',
    );
  });

  test('isKernelCommandId recognises it', () => {
    expect(isKernelCommandId(id)).toBe(true);
  });

  test('a change of period gives the same instant another id', () => {
    const at = Temporal.Instant.from('2026-01-01T00:00:00Z');
    const hourly = scheduleCommandId('ticker.everyTenant', 'a1', 3_600_000, at);
    const daily = scheduleCommandId('ticker.everyTenant', 'a1', 86_400_000, at);
    expect(hourly).toBe('kernel:schedule:ticker.everyTenant:a1:3600000:1767225600000');
    expect(daily).not.toBe(hourly);
  });
});
