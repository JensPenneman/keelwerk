import { describe, expect, test } from 'vitest';
import { doctorReadBounds } from '../../src/doctor/doctor-read-bounds.ts';
import { withinDeadline } from '../../src/doctor/within-deadline.ts';
import { createFakeHost } from '../support/fake-host.ts';

describe('the deadline of a read', () => {
  test('work that answers first gives its answer, and the timer is cancelled', async () => {
    const fake = createFakeHost();
    expect(await withinDeadline(fake.host.schedule, Promise.resolve('answer'), () => 'late')).toBe(
      'answer',
    );
    expect(fake.timers.map((timer) => [timer.milliseconds, timer.cancelled])).toEqual([
      [doctorReadBounds.deadlineMs, true],
    ]);
  });

  test('work that fails first fails, and the timer is cancelled', async () => {
    const fake = createFakeHost();
    await expect(
      withinDeadline(fake.host.schedule, Promise.reject(new Error('refused')), () => 'late'),
    ).rejects.toThrow('refused');
    expect(fake.timers.map((timer) => timer.cancelled)).toEqual([true]);
  });

  test('the deadline passing first gives what late gives, or its failure, and work that fails later is not an unhandled rejection', async () => {
    const fake = createFakeHost();
    const never = Promise.withResolvers<string>();
    const given = withinDeadline(fake.host.schedule, never.promise, () => 'late');
    fake.timers[0]?.fire();
    expect(await given).toBe('late');
    never.reject(new Error('too late'));
    const failing = withinDeadline(fake.host.schedule, new Promise<string>(() => undefined), () => {
      throw new Error('gave up');
    });
    fake.timers[1]?.fire();
    await expect(failing).rejects.toThrow('gave up');
  });
});
