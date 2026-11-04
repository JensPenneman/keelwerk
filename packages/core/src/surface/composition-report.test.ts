import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { teams } from '../../test/fixtures/modules/teams/src/module.generated.ts';
import { appOf } from '../../test/registry-kit.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import { compositionReport } from './composition-report.ts';
import { sortedJson } from './sorted-json.ts';

const full = compositionReport(buildRegistry(appOf([accounts, teams, auth])));
const alone = compositionReport(buildRegistry(appOf([auth])));

describe('compositionReport (section 16.2.6)', () => {
  test('lists the modules with their requires and optional lists', () => {
    expect(full.format).toBe('keelwerk.composition/1');
    expect(full.modules.map((module) => module.id)).toEqual(['accounts', 'auth', 'core', 'teams']);
    expect(full.modules.find((module) => module.id === 'auth')).toMatchObject({
      requires: [],
      optional: ['accounts', 'teams'],
      needs: ['live'],
    });
  });

  test('lists active contributions and conditional parts, and the dropped ones with the reason', () => {
    expect(full.contributions.map((part) => [part.id, part.kind, part.active])).toEqual([
      ['auth->accounts', 'contribution', true],
      ['auth->accounts[teams]', 'contribution', true],
    ]);
    expect(alone.contributions.every((part) => !part.active)).toBe(true);
    expect(alone.contributions.map((part) => part.droppedBecause)).toEqual([
      'targetAbsent',
      'targetAbsent',
    ]);
  });

  test('lists the extension points with their fillers, and the effective rules', () => {
    const points = full.extensionPoints.map((point) => point.ref);
    expect(points).toEqual([...points].sort());
    expect(
      full.extensionPoints.find((point) => point.ref === 'accounts.identityProviders'),
    ).toMatchObject({
      fillers: [{ module: 'auth', bound: true }],
    });
    const ids = full.rules.map((rule) => rule.id);
    expect(ids).toEqual([...ids].sort());
    expect(full.rules.find((rule) => rule.id === 'core.composition.operators')).toMatchObject({
      effect: 'allow',
      principal: 'operator',
      disabled: false,
    });
  });

  test('is the same for another tuple order', () => {
    const swapped = compositionReport(buildRegistry(appOf([auth, teams, accounts])));
    expect(sortedJson(swapped)).toBe(sortedJson(full));
  });
});
