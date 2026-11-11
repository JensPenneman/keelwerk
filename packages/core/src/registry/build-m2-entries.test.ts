import { describe, expect, test } from 'vitest';
import { m2Parts } from '../../test/fixtures/modules/m2-parts/src/module.generated.ts';
import { appOf } from '../../test/registry-kit.ts';
import { buildRegistry } from './build-registry.ts';

const registry = buildRegistry(appOf([m2Parts]));

describe('the M2 entries of the registry', () => {
  test('the fixture composes whole: no refusal names an asynchronous reaction', () => {
    expect(registry.problems.map((problem) => problem.code)).not.toContain(
      'asyncReactionsUnavailable',
    );
  });

  test("lists the fixture's stream, topic, version change and quotas by reference", () => {
    expect([...registry.streams.keys()]).toEqual(
      expect.arrayContaining(['core.effectAttempt', 'm2-parts.log']),
    );
    expect(registry.streams.get('m2-parts.log')).toMatchObject({
      module: 'm2-parts',
      name: 'log',
      readAs: 'm2-parts.task',
    });
    expect([...registry.topics.keys()]).toEqual(['m2-parts.progress']);
    expect([...registry.versionChanges.keys()]).toEqual(['m2-parts.displayName']);
    expect(
      [...registry.quotas.entries()].map(([ref, quota]) => [ref, quota.kind, quota.level]),
    ).toEqual([
      ['m2-parts.calls', 'rate', 'backend'],
      ['m2-parts.storageBytes', 'bytes', 'tenant'],
    ]);
    expect(registry.quotas.get('m2-parts.storageBytes')?.default).toBe('1GiB');
  });

  test('builds a process as a reaction entry with process, evolve, initial and events', () => {
    const entry = registry.reactions.get('m2-parts.onboarding');
    expect(entry).toMatchObject({
      process: true,
      on: ['m2-parts.task.renamed'],
      timing: 'async',
      ordering: 'fifo-per-key',
      coalesce: false,
      initial: { steps: 0 },
      events: ['stepped'],
    });
    expect(typeof entry?.evolve).toBe('function');
    expect(typeof entry?.key).toBe('function');
  });

  test("builds on: 'all' with its except list", () => {
    const entry = registry.reactions.get('m2-parts.auditAll');
    expect(entry).toMatchObject({
      process: false,
      on: 'all',
      except: ['m2-parts.task.renamed'],
    });
  });

  test('carries gate on the action and the module entries', () => {
    expect(registry.actions.get('m2-parts.start')?.gate).toBe('beta');
    expect(registry.modules.find((module) => module.id === 'm2-parts')?.gate).toBe('beta');
  });

  test('carries observes and configAccess on the module entry', () => {
    const entry = registry.modules.find((module) => module.id === 'm2-parts');
    expect(entry?.observes).toBe('all');
    expect(entry?.configAccess).toEqual({ level: 'tenant', edit: 'policy' });
    expect(registry.modules.find((module) => module.id === 'core')?.observes).toBeUndefined();
  });

  test("resolves a surface change's entity to its reference", () => {
    const change = registry.versionChanges.get('m2-parts.displayName');
    expect(change).toMatchObject({
      id: 'm2-parts.displayName',
      module: 'm2-parts',
      key: 'displayName',
      since: '1.0.0',
      input: {},
      output: {},
      errors: {},
    });
    expect(change?.surface).toEqual([
      { entity: 'm2-parts.task', field: 'displayName', renamedFrom: 'name' },
    ]);
    expect(change?.fixtures).toHaveLength(1);
  });
});
