import { describe, expect, test } from 'vitest';
import { processStreamRef } from './process-stream-ref.ts';

const backendId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01';
const tenantId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02';
const otherTenant = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a03';

describe('the state stream of a process instance', () => {
  test('golden: the stream is the process id and an id derived from scope, process and key', () => {
    expect(processStreamRef({ level: 'tenant', backendId, tenantId }, 'logs.tally', 'ada')).toEqual(
      { type: 'logs.tally', id: '01ce4749-eb41-8dde-9612-3e7862d4c977' },
    );
  });

  test('another tenant, another backend, another process or another key is another stream', () => {
    const base = processStreamRef({ level: 'tenant', backendId, tenantId }, 'logs.tally', 'ada');
    const ids = [
      processStreamRef({ level: 'tenant', backendId, tenantId: otherTenant }, 'logs.tally', 'ada'),
      processStreamRef({ level: 'backend', backendId }, 'logs.tally', 'ada'),
      processStreamRef({ level: 'tenant', backendId, tenantId }, 'logs.other', 'ada'),
      processStreamRef({ level: 'tenant', backendId, tenantId }, 'logs.tally', 'bob'),
    ].map((ref) => ref.id);
    expect(new Set([base.id, ...ids]).size).toBe(5);
  });
});
