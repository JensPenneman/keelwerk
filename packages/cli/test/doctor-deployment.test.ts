import type { DeploymentDefinition } from '@keelwerk/core';
import { env } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { ControlReader } from '../src/doctor/control-reader.ts';
import { deploymentChecks } from '../src/doctor/deployment-checks.ts';
import type { DeploymentInput } from '../src/doctor/deployment-input.ts';
import type { DoctorFinding } from '../src/doctor/doctor-finding.ts';
import { known } from '../src/doctor/known.ts';
import { unfedChecks } from '../src/doctor/unfed-checks.ts';
import { definitionOf } from './support/deployment-definition-of.ts';
import { input, judged, notChecked, sink, unfedNotes } from './support/deployment-input-of.ts';

describe('the deployment checks', () => {
  test('a sound deployment has nothing but lines for the checks that did not run and notes for the checks doctor does not have', async () => {
    const found = await deploymentChecks(input(definitionOf({ infrastructure: [sink()] })));
    expect(judged(found)).toEqual([]);
    expect(notChecked(found).length).toBeGreaterThan(0);
    // a sink is configured and no app declares a personal field: the anchor entries apply, the sampled ones do not
    expect(unfedNotes(found).map((finding) => finding.subject)).toEqual(
      unfedChecks.filter((check) => check.group !== 'personal-fields').map((check) => check.name),
    );
  });

  test('the operator socket: no file where doctor runs is not checked, an open mode is an error, no socket is nothing', async () => {
    const named = (found: readonly DoctorFinding[]) =>
      found.filter(
        (finding) =>
          finding.subject === 'operator socket mode' || finding.subject === '/run/keelwerk.sock',
      );
    const missing = await deploymentChecks(
      input(definitionOf(), { modeOf: async () => undefined }),
    );
    expect(
      named(missing).map((finding) => [finding.severity, finding.message, finding.fix]),
    ).toEqual([
      [
        'not-checked',
        'the operator socket /run/keelwerk.sock is declared and there is no file there where doctor runs',
        'run doctor on the machine that serves the operator socket, or correct `operator.socket`',
      ],
    ]);
    const open = await deploymentChecks(input(definitionOf(), { modeOf: async () => 0o666 }));
    expect(named(open).map((finding) => [finding.severity, finding.message])).toEqual([
      ['error', 'the operator socket has mode 666, so other users can reach it'],
    ]);
    const { operator: _operator, ...none } = definitionOf();
    expect(named(await deploymentChecks(input(none, { modeOf: async () => undefined })))).toEqual(
      [],
    );
  });

  test('the master key: not declared and not available are errors; a provider that rejects is not checked', async () => {
    const { keys: _keys, ...keyless } = definitionOf();
    const subjects = async (definition: DeploymentDefinition, over: Partial<DeploymentInput>) =>
      (await deploymentChecks(input(definition, over))).filter(
        (finding) => finding.subject === 'keys.masterKey' || finding.subject === 'master key',
      );
    expect((await subjects(keyless, {})).map((finding) => finding.message)).toEqual([
      'the deployment declares no master key',
    ]);
    expect((await subjects(definitionOf(), { env: {} })).map((finding) => finding.message)).toEqual(
      ['the master key secret is not available to this process'],
    );
    const failing = definitionOf({
      infrastructure: [
        {
          resolve: async () => {
            throw new Error('the vault does not answer');
          },
        },
      ],
    });
    expect(
      (await subjects(failing, {})).map((finding) => [
        finding.severity,
        finding.message,
        finding.fix,
      ]),
    ).toEqual([
      [
        'not-checked',
        'a secret provider failed to answer: the vault does not answer',
        'repair the secret provider named in the deployment file, then run doctor again',
      ],
    ]);
  });

  test('urls read through env() resolve before the clusters compare; one that cannot resolve is not checked', async () => {
    const definition = definitionOf({
      control: { adapter: 'postgres', url: env('CONTROL_URL') },
      placements: { main: { adapter: 'postgres', url: env('MAIN_URL') } },
    });
    const cluster = async (control: string | undefined, main: string | undefined) =>
      (
        await deploymentChecks(
          input(definition, {
            env: Object.fromEntries([
              ['KW_KEY', 'x'],
              ...(control === undefined ? [] : [['CONTROL_URL', control]]),
              ...(main === undefined ? [] : [['MAIN_URL', main]]),
            ]),
          }),
        )
      ).filter(
        (finding) =>
          finding.subject === 'control store shares a cluster' ||
          finding.subject === 'control store',
      );
    expect(await cluster('postgres://db1:5432/c', 'postgres://db2:5432/a')).toEqual([]);
    const shared = await cluster('postgres://db1:5432/c', 'postgres://db1:5432/a');
    expect(shared.map((finding) => finding.severity)).toEqual(['warning']);
    expect(shared[0]?.message).toContain('shares a cluster with main and no ledger sink');
    const placementUnset = await cluster('postgres://db1:5432/c', undefined);
    expect(placementUnset.map((finding) => [finding.severity, finding.message])).toEqual([
      ['not-checked', 'the url of main reads an environment variable that is not set'],
    ]);
    const unset = await cluster(undefined, 'postgres://db1:5432/a');
    expect(unset.map((finding) => [finding.severity, finding.message, finding.fix])).toEqual([
      [
        'not-checked',
        'the url of control reads an environment variable that is not set',
        'set the environment variable the url reads, then run doctor again',
      ],
    ]);
  });

  test('a ledger sink in the infrastructure silences the shared cluster warning', async () => {
    const found = await deploymentChecks(input(definitionOf({ infrastructure: [sink()] })));
    expect(found.map((finding) => finding.subject)).not.toContain('control store');
  });

  test('without a reader every check of the control store is not checked with the one reason, and nothing else is said of them', async () => {
    const found = await deploymentChecks(input(definitionOf({ infrastructure: [sink()] })));
    const reasons = notChecked(found).filter(
      (finding) => finding.message === 'the control store is not read',
    );
    expect(reasons.map((finding) => finding.subject).sort()).toEqual([
      'control store reachable',
      'epoch bumps',
      'failed tenant hooks',
      'held tenants',
      'processes',
    ]);
    expect(found.map((finding) => finding.message).join('\n')).not.toContain(
      'lists no running process',
    );
  });

  test('a reader that fails on one member leaves the others judged', async () => {
    const reader: ControlReader = {
      reachable: async () => ({ reachable: true, detail: 'answered' }),
      processes: async () => {
        throw new Error('the read timed out');
      },
      hookFailures: async () => ({
        failures: [{ hookId: 'billing.onTenantCreated', tenantId: 'tnt_2' }],
        olderUnread: false,
      }),
      bumpedMarks: async () => [],
      heldTenants: async () => [],
    };
    const found = await deploymentChecks(
      input(definitionOf({ infrastructure: [sink()] }), { reader: known(reader) }),
    );
    expect(
      found
        .filter((finding) => finding.check === 'health')
        .map((finding) => [finding.severity, finding.subject, finding.message, finding.fix]),
    ).toContainEqual([
      'not-checked',
      'processes',
      'the control store could not be read: the read timed out',
      'check that the control store answers at the url of the deployment file, then run doctor again',
    ]);
    expect(found.map((finding) => finding.message)).toContain(
      'the lifecycle hook billing.onTenantCreated failed for tenant tnt_2',
    );
    expect(found.map((finding) => finding.message)).not.toContain(
      'the control store lists no running process',
    );
  });
});
