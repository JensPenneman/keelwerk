import { describe, expect, test } from 'vitest';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { retireVersion } from './retire-version.ts';

const api = defineApiVersions({
  '2026-10-01': { deprecated: { at: '2026-10-10', sunset: '2026-11-01' } },
  '2026-11-04': { deprecated: { at: '2026-11-10', sunset: '2026-12-01' } },
  '2026-11-11': {},
});

function refusal(run: () => unknown): KeelwerkError {
  try {
    run();
  } catch (error) {
    return error as KeelwerkError;
  }
  return expect.unreachable('the retirement should have been refused');
}

describe('retireVersion (section 18.5)', () => {
  test('refuses a version before its sunset with core.conflict', () => {
    const error = refusal(() => retireVersion(api, '2026-11-04', '2026-11-20'));
    expect(error.code).toBe('core.conflict');
    expect(error.details).toEqual({ version: '2026-11-04', sunset: '2026-12-01' });
  });

  test('refuses a version that is not deprecated', () => {
    const error = refusal(() => retireVersion(api, '2026-11-11', '2026-11-20'));
    expect(error.code).toBe('core.conflict');
    expect(error.details).toEqual({ version: '2026-11-11' });
  });

  test('accepts a version past its sunset and names the first served version as the floor', () => {
    expect(retireVersion(api, '2026-10-01', '2026-11-20')).toEqual({
      version: '2026-10-01',
      floor: '2026-11-04',
    });
    expect(retireVersion(api, '2026-11-04', '2026-12-02')).toEqual({
      version: '2026-11-04',
      floor: '2026-11-11',
    });
  });

  test('accepts a version below the oldest declared', () => {
    expect(retireVersion(api, '2026-01-01', '2026-11-20')).toEqual({
      version: '2026-01-01',
      floor: '2026-11-04',
    });
  });

  test('an undeclared later date is core.api_version_unknown', () => {
    expect(refusal(() => retireVersion(api, '2026-11-05', '2026-11-20')).code).toBe(
      'core.api_version_unknown',
    );
    expect(refusal(() => retireVersion(undefined, '2026-11-05', '2026-11-20')).code).toBe(
      'core.api_version_unknown',
    );
  });

  test('a version whose support was extended does not set the target of an older retired one', () => {
    // One large customer keeps the oldest version until 2027; the middle one is retired already.
    const extended = defineApiVersions({
      '2026-01-01': { deprecated: { at: '2026-01-02', sunset: '2027-06-01' } },
      '2026-06-01': { deprecated: { at: '2026-06-02', sunset: '2026-07-01' } },
      '2026-11-11': {},
    });
    expect(retireVersion(extended, '2026-06-01', '2026-11-12')).toEqual({
      version: '2026-06-01',
      floor: '2026-11-11',
    });
    expect(refusal(() => retireVersion(extended, '2026-01-01', '2026-11-12')).code).toBe(
      'core.conflict',
    );
  });
});
