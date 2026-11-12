import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from './action-entry.ts';
import { checkPersonalScheduleInput } from './check-personal-schedule-input.ts';
import type { ScheduleEntry } from './schedule-entry.ts';

const actions = new Map<string, ActionEntry>([
  [
    'm.notify',
    {
      ref: 'm.notify',
      input: shape({
        userId: field.subject(),
        address: field.string().personal({ subject: 'userId' }),
      }),
    } as unknown as ActionEntry,
  ],
  [
    'm.sweep',
    { ref: 'm.sweep', input: shape({ olderThan: field.string() }) } as unknown as ActionEntry,
  ],
]);

const schedule = (invoke: string): ReadonlyMap<string, ScheduleEntry> =>
  new Map([
    [
      'm.nightly',
      {
        ref: 'm.nightly',
        module: 'm',
        name: 'nightly',
        every: '1d',
        invoke,
        scope: 'each-tenant',
      },
    ],
  ]);

describe('checkPersonalScheduleInput (9.5.6, 14.7.5)', () => {
  test('a schedule that invokes a command with a personal input member is refused', () => {
    expect(checkPersonalScheduleInput(schedule('m.notify'), actions)).toEqual([
      expect.objectContaining({
        code: 'personalScheduleInput',
        severity: 'error',
        module: 'm',
        ref: 'm.nightly',
      }),
    ]);
  });

  test('a command without a personal member, or one the app does not hold, passes', () => {
    expect(checkPersonalScheduleInput(schedule('m.sweep'), actions)).toEqual([]);
    expect(checkPersonalScheduleInput(schedule('m.gone'), actions)).toEqual([]);
  });
});
