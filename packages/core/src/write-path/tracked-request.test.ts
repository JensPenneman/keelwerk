import { expect, test } from 'vitest';
import type { RequestInfo } from '../invoker/request-info.ts';
import { trackedRequest } from './tracked-request.ts';

const request: RequestInfo = {
  transport: 'rest',
  userAgent: 'curl/8.7.1',
  requestId: 'req-1',
  connection: {
    id: 'conn-1',
    listener: 'http',
    remote: { address: '10.0.0.1', port: 5000 },
    local: { address: '10.0.0.2', port: 443 },
  },
};

test('reading the user agent records the user agent alone', () => {
  const tracked = trackedRequest(request);
  expect(tracked.request.userAgent).toBe('curl/8.7.1');
  expect(tracked.read()).toEqual({ userAgent: 'curl/8.7.1' });
});

test('reading the transport records the transport alone, never the user agent', () => {
  const tracked = trackedRequest(request);
  expect(tracked.request.transport).toBe('rest');
  const read = tracked.read();
  expect(read).toEqual({ transport: 'rest' });
  expect(read !== undefined && 'userAgent' in read).toBe(false);
});

test('reading both records both', () => {
  const tracked = trackedRequest(request);
  expect(tracked.request.userAgent).toBe('curl/8.7.1');
  expect(tracked.request.transport).toBe('rest');
  expect(tracked.read()).toEqual({ transport: 'rest', userAgent: 'curl/8.7.1' });
});

test('reading only the requestId records nothing', () => {
  const tracked = trackedRequest(request);
  expect(tracked.request.requestId).toBe('req-1');
  expect(tracked.read()).toBeUndefined();
});

test('reading the connection records the fact and never the address', () => {
  const tracked = trackedRequest(request);
  expect(tracked.request.connection).toBe(request.connection);
  const read = tracked.read();
  expect(read).toEqual({ connection: true });
  expect(JSON.stringify(read)).not.toContain('10.0.0.1');
});

test('reading a connection a request does not carry records nothing', () => {
  const tracked = trackedRequest({ transport: 'local', requestId: 'req-3' });
  expect(tracked.request.connection).toBeUndefined();
  expect(tracked.read()).toBeUndefined();
});

test('a request without a user agent records null once the user agent is read', () => {
  const tracked = trackedRequest({ transport: 'local', requestId: 'req-2' });
  expect(tracked.request.userAgent).toBeUndefined();
  expect(tracked.read()).toEqual({ userAgent: null });
  expect('userAgent' in tracked.request && Object.keys(tracked.request)).not.toContain('userAgent');
});
