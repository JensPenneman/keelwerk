import { expect, test } from 'vitest';
import { clientOrigin } from '../src/client-origin.ts';

test('trailing slashes are dropped from http and https origins', () => {
  expect(clientOrigin('https://example.com/')?.origin).toBe('https://example.com');
  expect(clientOrigin('http://example.com///')?.origin).toBe('http://example.com');
  expect(clientOrigin('http://example.com/a/b')?.origin).toBe('http://example.com/a/b');
  expect(clientOrigin('ftp://example.com')).toBeUndefined();
  expect(clientOrigin('unix:///run/app.sock')?.socketPath).toBe('/run/app.sock');
});

test('a very long run of slashes, or of slashes broken by one character, is linear', () => {
  const started = performance.now();
  expect(clientOrigin(`http://h${'/'.repeat(10_000)}`)?.origin).toBe('http://h');
  expect(clientOrigin(`http://h${'/'.repeat(10_000)}x`)?.origin).toBe(
    `http://h${'/'.repeat(10_000)}x`,
  );
  expect(clientOrigin(`http://h${'/x'.repeat(10_000)}`)?.origin).toBe(
    `http://h${'/x'.repeat(10_000)}`,
  );
  expect(performance.now() - started).toBeLessThan(500);
});
