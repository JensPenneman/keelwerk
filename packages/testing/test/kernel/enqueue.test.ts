import { describe, expect, test } from 'vitest';
import { command, effectsKit, registryWith, stored } from './support/effects-kit.ts';
import { otherTenant } from './support/invoker-kit.ts';
import { tenant } from './support/run-read-kit.ts';

describe('enqueue', () => {
  test('writes a job row with the build, the revision and the API version', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({
          effects: [
            {
              kind: 'enqueue',
              type: 'enqueue',
              action: 'library.later',
              input: { n: 2 },
              key: 'k-1',
              commandId: '00000000-0000-7000-8000-000000000003',
            },
          ],
        })),
        command('later', () => []),
      ],
    });
    const { adapter, invoke: run } = effectsKit(registry);
    await run('library.launch', {}, { commandId: '00000000-0000-7000-8000-000000000001' });
    const { jobs } = await stored(adapter);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'action',
      queue: 'commands',
      run: {
        action: 'library.later',
        input: { n: 2 },
        commandId: '00000000-0000-7000-8000-000000000003',
      },
      build: { id: 'build-42', revision: 7 },
      apiVersion: '2026-11-01',
      principal: { principalId: 'ada' },
      causation: {
        commandId: '00000000-0000-7000-8000-000000000001',
        actor: { kind: 'user', id: 'ada' },
      },
      key: {
        value: 'library:77db2baa623d0b6d257624d3fe72e12fdb5b562911153a9838a1f45b52038456',
        onConflict: 'keep',
      },
    });
    expect(jobs[0]?.scope).toEqual(tenant);
    const other = await stored(adapter, ['commands'], otherTenant);
    expect([other.jobs.length, other.effects.length]).toEqual([0, 0]);
  });

  test('a command of a level this unit cannot reach has no path', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({
          effects: [{ kind: 'enqueue', type: 'enqueue', action: 'library.elsewhere', input: {} }],
        })),
        command('elsewhere', () => [], { scope: 'deployment' }),
      ],
    });
    const { adapter, invoke: run } = effectsKit(registry);
    const outcome = await run('library.launch', {});
    expect(!outcome.ok && outcome.error.code).toBe('core.request_not_allowed');
    expect((await stored(adapter)).jobs).toHaveLength(0);
  });

  test('an enqueue with a command id that is no UUID or ULID fails the decision with validation', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({
          effects: [
            {
              kind: 'enqueue',
              type: 'enqueue',
              action: 'library.later',
              input: {},
              commandId: 'order-jan@example.com',
            },
          ],
        })),
        command('later', () => []),
      ],
    });
    const { adapter, invoke: run } = effectsKit(registry);
    const outcome = await run('library.launch', {});
    expect(!outcome.ok && outcome.error).toMatchObject({ code: 'core.validation' });
    expect(JSON.stringify(!outcome.ok && outcome.error)).not.toContain('order-jan');
    expect((await stored(adapter)).jobs).toHaveLength(0);
  });
});
