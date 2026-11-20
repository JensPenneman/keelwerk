import { describe, expect, test } from 'vitest';
import { actionDeprecationHeaders } from '../src/mount/action-deprecation-headers.ts';

const link = '</_keelwerk/v1/surface>; rel="deprecation"';

describe('actionDeprecationHeaders', () => {
  test('an action that is not deprecated adds nothing', () => {
    const headers = new Headers();
    actionDeprecationHeaders(headers, undefined, '2026-11-19');
    expect([...headers]).toEqual([]);
  });

  test('a deprecation that starts later adds nothing yet', () => {
    const headers = new Headers();
    actionDeprecationHeaders(
      headers,
      { reason: 'Use another.', at: '2026-12-01', sunset: '2027-01-01' },
      '2026-11-19',
    );
    expect([...headers]).toEqual([]);
  });

  test('a deprecation in force adds Deprecation, Sunset and the Link', () => {
    const headers = new Headers();
    actionDeprecationHeaders(
      headers,
      { reason: 'Use another.', at: '2026-11-05', sunset: '2027-01-01' },
      '2026-11-19',
    );
    expect(headers.get('deprecation')).not.toBeNull();
    expect(headers.get('sunset')).not.toBeNull();
    expect(headers.get('link')).toBe(link);
  });

  test('a deprecation without a date is in force: the Link and no Deprecation', () => {
    const headers = new Headers();
    actionDeprecationHeaders(headers, { reason: 'Use another.' }, '2026-11-19');
    expect(headers.get('deprecation')).toBeNull();
    expect(headers.get('link')).toBe(link);
  });
});
