import { describe, expect, it } from 'vitest';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { readBoundedBody } from './read-bounded-body.ts';

/** A POST whose body is the given chunks; `seen.cancelled` tells whether the reader was cancelled. */
function requestOf(chunks: readonly number[], headers: Record<string, string> = {}) {
  const seen = { cancelled: false };
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const size = chunks[index];
      index += 1;
      if (size === undefined) controller.close();
      else controller.enqueue(new Uint8Array(size).fill(7));
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  const request = new Request('http://host.test/x', {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  } as RequestInit);
  return { request, seen };
}

const refusal = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

describe('readBoundedBody', () => {
  it('refuses a declared length over the bound before any read', async () => {
    const { request } = requestOf([4], { 'content-length': '11' });
    const thrown = await refusal(readBoundedBody(request, 10));
    expect(thrown).toBeInstanceOf(KeelwerkError);
    expect(thrown).toMatchObject({ code: 'core.payload_too_large' });
    expect(request.bodyUsed).toBe(false);
  });

  it('refuses streamed bytes one over the bound and cancels the reader', async () => {
    const { request, seen } = requestOf([6, 5, 3]);
    const thrown = await refusal(readBoundedBody(request, 10));
    expect(thrown).toMatchObject({ code: 'core.payload_too_large' });
    expect(seen.cancelled).toBe(true);
  });

  it('accepts a body of exactly the bound', async () => {
    const { request } = requestOf([6, 4], { 'content-length': '10' });
    const bytes = await readBoundedBody(request, 10);
    expect(bytes).toHaveLength(10);
    expect(bytes?.every((byte) => byte === 7)).toBe(true);
  });

  it('gives undefined for a request with no body', async () => {
    expect(await readBoundedBody(new Request('http://host.test/x'), 10)).toBeUndefined();
  });
});
