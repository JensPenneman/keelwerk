import type { StorageScope, StreamAppend } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { backendScope } from './support/backend-scope.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { entityOf } from './support/entity-of.ts';
import { failure } from './support/failure.ts';
import { id } from './support/id.ts';
import { openMemory } from './support/memory-fixture.ts';
import { newEvent } from './support/new-event.ts';
import { setting } from './support/setting.ts';
import { tenantScope } from './support/tenant-scope.ts';

const invocation = entityOf('app.receipt', 'app__receipt', 'invocation', {});

const stream = (n: number, type = 'app.note'): { type: string; id: string } => ({
  type,
  id: id(n),
});

function append(
  n: number,
  events: readonly number[],
  over: Partial<StreamAppend> = {},
): StreamAppend {
  return {
    stream: stream(n),
    expectedVersion: 0,
    partition: null,
    events: events.map((event) => newEvent(event)),
    ...over,
  };
}

describe('the tenancy of a stream', () => {
  test("a stream rides only with a unit of its entity's tenancy", async () => {
    const memory = openMemory([setting, invocation]);
    const refused = async (scope: StorageScope, type: string) =>
      failure(
        memory.run(scope, (unit) =>
          unit.events.append([append(1, [1], { stream: stream(1, type) })]),
        ),
      );
    const forbidden = { kind: 'forbidden', code: 'core.forbidden' };
    expect(await refused(backendScope, 'app.note')).toEqual(forbidden);
    expect(await refused(deploymentScope, 'app.note')).toEqual(forbidden);
    expect(await refused(tenantScope, 'app.setting')).toEqual(forbidden);
    expect(await refused(deploymentScope, 'app.setting')).toEqual(forbidden);
    expect(await refused(tenantScope, 'app.global')).toEqual(forbidden);
    expect(await refused(backendScope, 'app.global')).toEqual(forbidden);
    for (const [scope, type] of [
      [tenantScope, 'app.note'],
      [backendScope, 'app.setting'],
      [deploymentScope, 'app.global'],
    ] as const) {
      expect(
        await memory.run(scope, (unit) =>
          unit.events.append([append(2, [1], { stream: stream(2, type) })]),
        ),
      ).toHaveLength(1);
    }
    for (const scope of [tenantScope, backendScope]) {
      expect(
        await memory.run(scope, (unit) =>
          unit.events.append([append(3, [1], { stream: stream(3, 'app.receipt') })]),
        ),
      ).toHaveLength(1);
    }
    expect(await refused(deploymentScope, 'app.receipt')).toEqual(forbidden);
  });
});
