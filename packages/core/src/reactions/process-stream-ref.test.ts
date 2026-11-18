import { describe, expect, test } from 'vitest';
import { processStreamRef } from './process-stream-ref.ts';

const backendId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01';
const tenantId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02';
const otherTenant = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a03';
const secret = new Uint8Array(32).fill(7);

describe('the state stream of a process instance', () => {
  // WP-130: the stream id derives from the digest of the instance key under the job key secret,
  // bound to the process, so the golden id was regenerated and another secret is another stream.
  test('golden: the stream is the process id and an id derived from scope, process and key', () => {
    expect(
      processStreamRef({ level: 'tenant', backendId, tenantId }, 'logs.tally', 'ada', secret),
    ).toEqual({ type: 'logs.tally', id: '8008bfd6-51a9-8bbe-bc25-4e0856593e44' });
  });

  test('another secret is another stream', () => {
    const scope = { level: 'tenant', backendId, tenantId } as const;
    expect(processStreamRef(scope, 'logs.tally', 'ada', new Uint8Array(32).fill(8)).id).not.toBe(
      processStreamRef(scope, 'logs.tally', 'ada', secret).id,
    );
  });

  test('another tenant, another backend, another process or another key is another stream', () => {
    const base = processStreamRef(
      { level: 'tenant', backendId, tenantId },
      'logs.tally',
      'ada',
      secret,
    );
    const ids = [
      processStreamRef(
        { level: 'tenant', backendId, tenantId: otherTenant },
        'logs.tally',
        'ada',
        secret,
      ),
      processStreamRef({ level: 'backend', backendId }, 'logs.tally', 'ada', secret),
      processStreamRef({ level: 'tenant', backendId, tenantId }, 'logs.other', 'ada', secret),
      processStreamRef({ level: 'tenant', backendId, tenantId }, 'logs.tally', 'bob', secret),
    ].map((ref) => ref.id);
    expect(new Set([base.id, ...ids]).size).toBe(5);
  });
});
