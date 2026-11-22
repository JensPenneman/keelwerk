import { describe, expect, test } from 'vitest';
import { absent } from '../../src/doctor/absent.ts';
import { defineCheck } from '../../src/doctor/define-check.ts';
import { definePlacementCheck } from '../../src/doctor/define-placement-check.ts';
import { deploymentCheckList } from '../../src/doctor/deployment-check-list.ts';
import type { DoctorFinding } from '../../src/doctor/doctor-finding.ts';
import type { Fact } from '../../src/doctor/fact.ts';
import { known } from '../../src/doctor/known.ts';
import { runDeploymentChecks } from '../../src/doctor/run-deployment-checks.ts';
import { unfedCheck } from '../../src/doctor/unfed-check.ts';
import { capabilitiesOf, factsOf } from '../support/facts-of.ts';

const finding: DoctorFinding = {
  check: 'g',
  severity: 'warning',
  subject: 's',
  message: 'm',
  fix: 'f',
};

describe('the runner of the deployment checks', () => {
  test('a check whose needed fact is absent gives one line with the reason and is never judged', () => {
    const calls: object[] = [];
    const check = defineCheck({
      group: 'g',
      name: 'n',
      needs: ['processes'],
      judge: (values) => {
        calls.push(values);
        return [finding];
      },
    });
    const missing = runDeploymentChecks(
      [check],
      factsOf({ processes: absent('no reader', 'connect a reader') }),
    );
    expect(missing).toEqual([
      expect.objectContaining({
        check: 'g',
        severity: 'not-checked',
        subject: 'n',
        message: 'no reader',
        fix: 'connect a reader',
      }),
    ]);
    expect(calls).toHaveLength(0);
    const present = runDeploymentChecks([check], factsOf({ processes: known([]) }));
    expect(present).toEqual([finding]);
    expect(calls).toEqual([{ processes: [] }]);
  });

  test('two absent needs give one line with both reasons', () => {
    const check = defineCheck({
      group: 'g',
      name: 'n',
      needs: ['processes', 'heldTenants'],
      judge: () => [finding],
    });
    const found = runDeploymentChecks(
      [check],
      factsOf({ processes: absent('first', 'do one'), heldTenants: absent('second', 'do two') }),
    );
    expect(found.map((entry) => [entry.message, entry.fix])).toEqual([
      ['first; second', 'do one; do two'],
    ]);
  });

  test('a reason and a fix that several absent needs share are printed once; different reasons are all printed', () => {
    const check = defineCheck({
      group: 'g',
      name: 'n',
      needs: ['processes', 'heldTenants'],
      judge: () => [finding],
    });
    const lines = (processes: Fact<never>, heldTenants: Fact<never>) =>
      runDeploymentChecks([check], factsOf({ processes, heldTenants })).map((entry) => [
        entry.severity,
        entry.message,
        entry.fix,
      ]);
    expect(lines(absent('no reader', 'connect one'), absent('no reader', 'connect one'))).toEqual([
      ['not-checked', 'no reader', 'connect one'],
    ]);
    expect(lines(absent('no reader', 'connect one'), absent('it broke', 'connect one'))).toEqual([
      ['not-checked', 'no reader; it broke', 'connect one'],
    ]);
  });

  test('a check that has nothing to look at gives nothing; an unfed check that has gives its note', () => {
    let judged = 0;
    const idle = defineCheck({
      group: 'g',
      name: 'idle',
      needs: ['ledgerSinks'],
      applies: ({ ledgerSinks }) => ledgerSinks > 0,
      judge: () => {
        judged += 1;
        return [finding];
      },
    });
    const unfed = unfedCheck({
      group: 'g',
      name: 'unfed',
      needs: ['ledgerSinks'],
      applies: ({ ledgerSinks }) => ledgerSinks > 0,
      reason: 'nothing feeds it',
    });
    expect(runDeploymentChecks([idle, unfed], factsOf({ ledgerSinks: known(0) }))).toEqual([]);
    expect(judged).toBe(0);
    const found = runDeploymentChecks([idle, unfed], factsOf({ ledgerSinks: known(2) }));
    expect(found.map((entry) => [entry.subject, entry.severity, entry.message, entry.fix])).toEqual(
      [
        ['s', 'warning', 'm', 'f'],
        ['unfed', 'note', 'doctor does not check this: nothing feeds it', 'none needed'],
      ],
    );
    expect(judged).toBe(1);
  });

  test('an unfed check whose needed fact is absent prints its note and no line of severity not-checked', () => {
    const behind = unfedCheck({
      group: 'g',
      name: 'behind',
      needs: ['ledgerSinks'],
      applies: ({ ledgerSinks }) => ledgerSinks > 0,
      reason: 'nothing feeds it',
    });
    const always = unfedCheck({
      group: 'g',
      name: 'always',
      needs: ['ledgerSinks', 'personalFields'],
      reason: 'nothing feeds it either',
    });
    const found = runDeploymentChecks(
      [behind, always],
      factsOf({
        ledgerSinks: absent('the sinks cannot be listed', 'list them'),
        personalFields: absent('the fields cannot be listed', 'list them'),
      }),
    );
    expect(found.map((entry) => [entry.subject, entry.severity, entry.message, entry.fix])).toEqual(
      [
        ['behind', 'note', 'doctor does not check this: nothing feeds it', 'none needed'],
        ['always', 'note', 'doctor does not check this: nothing feeds it either', 'none needed'],
      ],
    );
  });

  test('a placement check gives one line for the placement doctor could not open and judges the other once', () => {
    const judged: string[] = [];
    const check = definePlacementCheck({
      group: 'g',
      name: 'per placement',
      needs: [],
      concerns: (_values, placement) => placement.name !== 'skipped',
      judge: (_values, placement) => {
        judged.push(placement.name);
        return [finding];
      },
    });
    const placements = ['opened', 'closed', 'skipped'].map((name) => ({
      name,
      adapter: 'postgres',
      apps: [],
      capabilities:
        name === 'opened'
          ? known(capabilitiesOf({ sql: false }))
          : absent<never>('not opened', 'open it'),
    }));
    const found = runDeploymentChecks([check], factsOf({ placements }));
    expect(found.map((entry) => [entry.severity, entry.subject, entry.message])).toEqual([
      ['warning', 's', 'm'],
      ['not-checked', 'closed', 'per placement: not opened'],
    ]);
    expect(found.at(-1)?.fix).toBe('open it');
    expect(judged).toEqual(['opened']);
  });

  test('every unfed check of the list gives exactly one line where it has something to look at, and none where it has not', () => {
    const unfed = deploymentCheckList.filter((check) => check.kind === 'unfed');
    expect(unfed.length).toBeGreaterThan(0);
    const field = {
      field: 'a.b.c',
      kind: 'string',
      queries: ['eq'],
      keys: 'subject' as const,
      normalizer: 'text/1',
      prefixMin: 3,
      containsBits: 8,
      searchKeys: [],
    };
    const busy = runDeploymentChecks(
      unfed,
      factsOf({ ledgerSinks: known(1), personalFields: known([field]) }),
    );
    expect(busy.map((entry) => entry.subject)).toEqual(unfed.map((check) => check.name));
    expect(
      busy.every(
        (entry) =>
          entry.severity === 'note' &&
          entry.message.startsWith('doctor does not check this: ') &&
          entry.fix === 'none needed' &&
          !/not.checked/i.test(entry.message),
      ),
    ).toBe(true);
    // one entry that prints on every deployment and one behind `applies`, in full
    expect(
      busy
        .filter(
          (entry) =>
            entry.subject === 'external-table drift' ||
            entry.subject === 'head below newest anchor',
        )
        .map((entry) => [entry.check, entry.severity, entry.subject, entry.message, entry.fix]),
    ).toEqual([
      [
        'deployment',
        'note',
        'external-table drift',
        'doctor does not check this: nothing compares external tables with their mappings',
        'none needed',
      ],
      [
        'anchors',
        'note',
        'head below newest anchor',
        'doctor does not check this: doctor reads neither the heads of the scopes nor the ledger sinks',
        'none needed',
      ],
    ]);
    const idle = runDeploymentChecks(
      unfed,
      factsOf({ ledgerSinks: known(0), personalFields: known([]) }),
    );
    expect(idle.map((entry) => entry.check)).not.toContain('anchors');
    expect(idle.map((entry) => entry.check)).not.toContain('personal-fields');
    expect(idle.length).toBeGreaterThan(0);
  });
});
