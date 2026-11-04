import { expect, test } from 'vitest';
import { escapeLike } from './escape-like.ts';

test('wildcards and the escape character match literally', () => {
  expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
});

test('other text is unchanged', () => {
  expect(escapeLike("plain 'text' é")).toBe("plain 'text' é");
});
