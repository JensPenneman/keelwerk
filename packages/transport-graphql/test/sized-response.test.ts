import { describe, expect, test } from 'vitest';
import { sizedResponse } from '../src/mount/sized-response.ts';

function lengthOf(response: Response): string | null {
  return response.headers.get('content-length');
}

describe('a complete JSON or HTML answer carries its length', () => {
  test.each([
    'application/json',
    'application/json; charset=utf-8',
    'APPLICATION/GRAPHQL-RESPONSE+JSON',
    'text/html;charset=utf-8',
  ])('%s', async (contentType) => {
    const answer = await sizedResponse(
      new Response('{"data":"é"}', { status: 202, headers: { 'content-type': contentType } }),
    );
    expect(lengthOf(answer)).toBe('13');
    expect(answer.status).toBe(202);
    expect(answer.headers.get('content-type')).toBe(contentType);
    expect(await answer.text()).toBe('{"data":"é"}');
  });
});

describe('every other answer passes through untouched', () => {
  test.each([
    'text/event-stream',
    'multipart/mixed; boundary="-"',
    'application/json-seq',
    'application/jsonl',
    'text/htmlx',
  ])('%s', async (contentType) => {
    const original = new Response('body', { headers: { 'content-type': contentType } });
    const answer = await sizedResponse(original);
    expect(answer).toBe(original);
    expect(lengthOf(answer)).toBeNull();
  });

  test('an answer without a body and one that has a length already', async () => {
    const empty = new Response(null, {
      status: 204,
      headers: { 'content-type': 'application/json' },
    });
    expect(await sizedResponse(empty)).toBe(empty);
    const sized = new Response('x', {
      headers: { 'content-type': 'application/json', 'content-length': '1' },
    });
    expect(await sizedResponse(sized)).toBe(sized);
  });
});
