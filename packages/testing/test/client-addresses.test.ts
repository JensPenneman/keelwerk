import type { HostFetchOptions } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import { clientAddresses } from '../src/harness/client-addresses.ts';
import { clientFetchOf } from '../src/harness/client-fetch-of.ts';

describe('client addresses', () => {
  it('a source answers 198.18.0.1, 198.18.0.2 and so on, and crosses into 198.19.0.0', () => {
    const next = clientAddresses();
    expect(next()).toBe('198.18.0.1');
    expect(next()).toBe('198.18.0.2');
    let last = '';
    for (let i = 3; i <= 65_536; i += 1) {
      last = next();
    }
    expect(last).toBe('198.19.0.0');
  });

  it('two sources are independent', () => {
    expect(clientAddresses()()).toBe('198.18.0.1');
    expect(clientAddresses()()).toBe('198.18.0.1');
  });

  it('a source throws a RangeError once the range is spent', () => {
    const next = clientAddresses();
    let last = '';
    for (let i = 1; i <= 131_070; i += 1) {
      last = next();
    }
    expect(last).toBe('198.19.255.254');
    expect(() => next()).toThrow(RangeError);
  });

  it('clientFetchOf gives each request the next address and passes a named one', async () => {
    const seen: (string | undefined)[] = [];
    const fetch = clientFetchOf({
      fetch: (_request: Request, options?: HostFetchOptions) => {
        seen.push(options?.remoteAddress);
        return Promise.resolve(new Response(null));
      },
    });
    const request = new Request('https://app.example/');
    await fetch(request);
    await fetch(request);
    await fetch(request, { remoteAddress: '203.0.113.7' });
    await fetch(request);
    expect(seen).toEqual(['198.18.0.1', '198.18.0.2', '203.0.113.7', '198.18.0.3']);
  });
});
