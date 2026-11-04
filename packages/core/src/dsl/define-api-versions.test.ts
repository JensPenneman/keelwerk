import { describe, expect, test } from 'vitest';
import { coreApiVersions } from '../core-module/core-api-versions.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { defineApiVersions } from './define-api-versions.ts';

function refusal(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(KeelwerkError);
    return (error as KeelwerkError).details;
  }
  return expect.unreachable();
}

describe('defineApiVersions (section 18.2)', () => {
  test('keeps the versions oldest first and names the head', () => {
    const api = defineApiVersions({
      '2026-10-23': { deprecated: { at: '2027-01-12', sunset: '2028-01-12' } },
      '2027-01-12': {},
    });
    expect(api.dates).toEqual(['2026-10-23', '2027-01-12']);
    expect(api.head).toBe('2027-01-12');
    expect(api.versions['2026-10-23'].deprecated?.sunset).toBe('2028-01-12');
  });

  test('refuses a list that is empty', () => {
    expect(refusal(() => defineApiVersions({}))).toMatchObject({ code: 'invalidApiVersions' });
  });

  test('refuses a date that is not on the calendar', () => {
    const date = '2026-02-30';
    expect(refusal(() => defineApiVersions({ [date]: {} }))).toMatchObject({
      code: 'invalidApiVersions',
      ref: date,
    });
  });

  test('refuses versions that are not strictly increasing', () => {
    expect(refusal(() => defineApiVersions({ '2027-01-12': {}, '2026-10-23': {} }))).toMatchObject({
      code: 'invalidApiVersions',
      ref: '2026-10-23',
    });
  });

  test('refuses a sunset that does not follow the deprecation', () => {
    expect(
      refusal(() =>
        defineApiVersions({
          '2026-10-23': { deprecated: { at: '2027-01-12', sunset: '2027-01-12' } },
        }),
      ),
    ).toMatchObject({ code: 'invalidApiVersions', ref: '2026-10-23' });
  });

  test('the core declares its own versions (S-33)', () => {
    expect(coreApiVersions.head).toBe('2026-11-04');
    expect(coreApiVersions.dates).toEqual(['2026-11-04']);
  });
});
