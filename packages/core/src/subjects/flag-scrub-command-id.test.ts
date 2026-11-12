import { describe, expect, test } from 'vitest';
import { isKernelCommandId } from '../ids/is-kernel-command-id.ts';
import { flagScrubCommandId } from './flag-scrub-command-id.ts';

const tenantId = '0192f3a0-0000-7000-8000-000000000001';
const subjectId = '0192f3a0-0000-7000-8000-0000000000a1';

describe('the command id of the flag scrub of one erasure', () => {
  test('golden: the kernel form with the hash of the identity', () => {
    expect(flagScrubCommandId({ tenantId, commandId: 'erase-1', subjectId })).toBe(
      'kernel:erasure:f8191434b13e2a9be96cd9065205d27f2b448bd87cceefe22064b272e73bf974:flags',
    );
  });

  test('is one id for every spelling of the subject, and another for another tenant, command id or subject', () => {
    const base = flagScrubCommandId({ tenantId, commandId: 'erase-1', subjectId });
    expect(
      flagScrubCommandId({
        tenantId,
        commandId: 'erase-1',
        subjectId: subjectId.replaceAll('-', '').toUpperCase(),
      }),
    ).toBe(base);
    const others = [
      flagScrubCommandId({ tenantId: tenantId.replace('1', '2'), commandId: 'erase-1', subjectId }),
      flagScrubCommandId({ tenantId, commandId: 'erase-2', subjectId }),
      flagScrubCommandId({
        tenantId,
        commandId: 'erase-1',
        subjectId: subjectId.replace('a1', 'a2'),
      }),
    ];
    expect(new Set([base, ...others]).size).toBe(4);
  });

  test('has a fixed length, however long the command id is, and is a kernel id', () => {
    const long = flagScrubCommandId({ tenantId, commandId: 'x'.repeat(255), subjectId });
    expect(long).toHaveLength(flagScrubCommandId({ tenantId, commandId: 'y', subjectId }).length);
    expect(long.length).toBeLessThanOrEqual(255);
    expect(isKernelCommandId(long)).toBe(true);
  });
});
