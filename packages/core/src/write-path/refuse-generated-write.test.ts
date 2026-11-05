import { describe, expect, it } from 'vitest';
import { runtimeOperator } from '../principals/runtime-operator.ts';
import type { Unit } from '../storage/unit.ts';
import { attemptCommand } from './attempt-command.ts';
import { refuseGeneratedWrite } from './refuse-generated-write.ts';
import type { RunCommandInput } from './run-command-input.ts';

const client = { ...runtimeOperator, id: 'op_1', via: 'core.operatorToken' };

function runOf(
  ref: string,
  entity: string,
  generated: string | undefined,
  input: unknown,
  principal = client,
): RunCommandInput {
  return {
    action: { ref, module: 'core', entity, generated },
    input,
    principal,
    keys: {},
  } as unknown as RunCommandInput;
}

describe('writes only the control path makes', () => {
  it.each([
    ['core.tenant.create', 'core.tenant', 'control.createTenant'],
    ['core.backend.create', 'core.backend', 'control.createBackend'],
  ])('refuses %s outside the control path, even for the runtime operator', (ref, entity, via) => {
    for (const principal of [client, runtimeOperator]) {
      expect(() =>
        refuseGeneratedWrite(runOf(ref, entity, undefined, { name: 'x' }, principal)),
      ).toThrowError(new RegExp(`Runtime\\.${via.replace('.', '\\.')}`));
    }
  });

  it('lets the control path create', () => {
    for (const ref of ['core.tenant.create', 'core.backend.create']) {
      expect(() =>
        refuseGeneratedWrite({
          ...runOf(ref, 'core.x', undefined, { name: 't' }),
          controlPath: true,
        }),
      ).not.toThrow();
    }
  });

  it('refuses a placement change and a pin on a nested attempt, before any unit work', async () => {
    const attempt = (run: RunCommandInput) =>
      attemptCommand(
        {
          run,
          commandId: 'c1',
          fingerprint: 'f',
          clock: { now: () => Temporal.Now.instant() },
          prepared: undefined,
        },
        {} as Unit,
      );
    await expect(
      attempt(runOf('core.tenant.update', 'core.tenant', 'update', { id: 't', backendId: 'b' })),
    ).rejects.toMatchObject({ kind: 'not_implemented' });
    await expect(
      attempt(runOf('core.tenant.update', 'core.tenant', 'update', { id: 't', apiVersion: 'v' })),
    ).rejects.toMatchObject({ kind: 'validation' });
    await expect(
      attempt(
        runOf('core.backend.update', 'core.backend', 'update', {
          id: 'b',
          config: { core: { introspection: 'nonsense' } },
        }),
      ),
    ).rejects.toMatchObject({
      kind: 'validation',
      message: expect.stringMatching(/not supported in M1/),
    });
    await expect(
      attempt(runOf('core.tenant.create', 'core.tenant', undefined, { name: 't' })),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
});
