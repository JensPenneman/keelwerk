import { describe, expect, test } from 'vitest';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { endReasonOfError } from './end-reason-of-error.ts';

describe('endReasonOfError', () => {
  test('version_retired for core.api_version_retired, undefined for any other error', () => {
    const retired = new KeelwerkError({
      kind: 'not_found',
      code: 'core.api_version_retired',
      message: 'Gone.',
    });
    expect(endReasonOfError(retired)).toBe('version_retired');
    expect(endReasonOfError(errors.internal('Broken.'))).toBeUndefined();
    expect(endReasonOfError(new Error('x'))).toBeUndefined();
  });
});
