import { describe, expect, test } from 'vitest';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { resolveVersion } from './resolve-version.ts';

const api = defineApiVersions({
  '2026-10-23': { deprecated: { at: '2027-01-12', sunset: '2028-01-12' } },
  '2027-01-12': {},
});
const base = { dates: api.dates, versions: api.versions, today: '2027-02-01' };

function refusal(over: Partial<Parameters<typeof resolveVersion>[0]>): KeelwerkError {
  try {
    resolveVersion({ ...base, ...over });
  } catch (error) {
    return error as KeelwerkError;
  }
  return expect.unreachable('the version should have been refused');
}

describe('resolveVersion (section 18.3)', () => {
  test('the head answers when nothing names a version', () => {
    expect(resolveVersion(base)).toEqual({ apiVersion: '2027-01-12', deprecation: null });
  });

  test('the request beats the credential, the credential beats the pin, the pin beats the head', () => {
    const all = { requested: '2027-01-12', credential: '2026-10-23', pinned: '2026-10-23' };
    expect(resolveVersion({ ...base, ...all }).apiVersion).toBe('2027-01-12');
    expect(
      resolveVersion({ ...base, credential: '2027-01-12', pinned: '2026-10-23' }).apiVersion,
    ).toBe('2027-01-12');
    expect(resolveVersion({ ...base, pinned: '2026-10-23' }).apiVersion).toBe('2026-10-23');
  });

  test('a deprecated version announces its dates from the day it is deprecated', () => {
    expect(resolveVersion({ ...base, requested: '2026-10-23' }).deprecation).toEqual({
      at: '2027-01-12',
      sunset: '2028-01-12',
    });
    expect(
      resolveVersion({ ...base, requested: '2026-10-23', today: '2026-12-01' }).deprecation,
    ).toBeNull();
  });

  test('a date that is not a version of the app is unknown, 400 in REST', () => {
    const error = refusal({ requested: '2027-06-01' });
    expect(error).toMatchObject({ kind: 'validation', code: 'core.api_version_unknown' });
  });

  test('text that is not a date is invalid', () => {
    expect(refusal({ requested: 'latest' })).toMatchObject({
      kind: 'validation',
      code: 'core.api_version_invalid',
    });
    expect(refusal({ requested: '' }).code).toBe('core.api_version_invalid');
  });

  test('a date below the floor, or a version past its sunset, is retired, 410 in REST', () => {
    expect(refusal({ requested: '2020-01-01' })).toMatchObject({
      kind: 'not_found',
      code: 'core.api_version_retired',
    });
    expect(refusal({ requested: '2026-10-23', today: '2028-01-13' }).code).toBe(
      'core.api_version_retired',
    );
    expect(
      resolveVersion({ ...base, requested: '2026-10-23', today: '2028-01-12' }).apiVersion,
    ).toBe('2026-10-23');
  });

  test('a stored pin is held to the same rules', () => {
    expect(refusal({ pinned: '2027-06-01' }).code).toBe('core.api_version_unknown');
  });
});
