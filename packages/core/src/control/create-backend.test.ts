import { describe, expect, test } from 'vitest';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ControlRun } from './control-run.ts';
import type { ControlStore } from './control-store.ts';
import { createBackend } from './create-backend.ts';

// Every refusal below comes before the store is read, so a store that fails when touched proves it.
const store = new Proxy({} as ControlStore, {
  get: () => {
    throw new Error('the store was touched');
  },
});
const who = {} as ControlRun;
const input = (quotas: unknown) => ({
  name: 'acme',
  app: 'shop',
  placement: 'main',
  config: { core: { quotas } },
});

describe('createBackend, the quota values of the core configuration', () => {
  test('members and no checker fail closed as internal', async () => {
    await expect(createBackend(store, input({ 'notes.rows': '4' }), who)).rejects.toMatchObject({
      kind: 'internal',
    });
  });

  test('a refusal of the checker is a validation error at the member path, before the store is read', async () => {
    const refusing = (dimension: string): string => {
      throw errors.validation(`${dimension} is not a quota dimension`);
    };
    const refused = await createBackend(store, input({ 'typo.rows': '5' }), who, {
      checkQuotaValue: refusing,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(KeelwerkError);
    expect(refused).toMatchObject({
      kind: 'validation',
      issues: [
        { path: ['core', 'quotas', 'typo.rows'], message: 'typo.rows is not a quota dimension' },
      ],
    });
  });

  test('an error that is not a validation error passes through', async () => {
    await expect(
      createBackend(store, input({ 'notes.rows': '4' }), who, {
        checkQuotaValue: () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
  });

  test('a shape refusal of the member comes first: default is refused at its path', async () => {
    await expect(
      createBackend(store, input({ 'notes.rows': 'default' }), who, {
        checkQuotaValue: (_dimension, limit) => limit,
      }),
    ).rejects.toMatchObject({
      kind: 'validation',
      issues: [expect.objectContaining({ path: ['core', 'quotas', 'notes.rows'] })],
    });
  });
});
