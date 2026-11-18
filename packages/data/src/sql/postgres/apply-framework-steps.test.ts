import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyFrameworkSteps } from './apply-framework-steps.ts';
import { frameworkSteps } from './framework-steps.ts';

/** A session of a root that does not exist yet, so every step runs. */
function session() {
  const recorded: { readonly id: string; readonly duration: number }[] = [];
  return {
    recorded,
    query: async (sql: string, parameters: readonly unknown[] = []) => {
      if (sql.startsWith('select to_regclass')) return { rows: [{ present: false }] };
      if (sql.startsWith('select id, checksum')) return { rows: [] };
      if (sql.includes('insert into') && sql.includes('kw_migrations')) {
        recorded.push({ id: String(parameters[1]), duration: Number(parameters[4]) });
      }
      return { rows: [] };
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the duration the framework track records for a step', () => {
  test('a step with no statement for the root records 0, however slow the machine is', async () => {
    // Every reading of the clock is 5 ms after the one before: a loaded machine.
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 5;
      return now;
    });
    const kit = session();
    await applyFrameworkSteps(kit as never, {
      root: 'example',
      control: false,
      role: undefined,
      fresh: true,
      now: Temporal.Instant.from('2026-11-18T10:00:00Z'),
    });
    const [last] = kit.recorded.slice(-1);
    expect(frameworkSteps.at(-1)?.id).toBe(last?.id);
    expect(frameworkSteps.at(-1)?.ddl('example', {})).toEqual([]);
    expect(last?.duration).toBe(0);
    // A step that runs statements records the time it took.
    expect(kit.recorded[0]?.duration).toBeGreaterThan(0);
  });
});
