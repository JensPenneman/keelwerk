import { describe, expect, it } from 'vitest';
import { problemTitles } from '../http/problem-titles.ts';
import { errorKinds } from './error-kinds.ts';

describe('errorKinds', () => {
  it('holds every kind of ErrorKind once', () => {
    expect([...errorKinds].sort()).toEqual(Object.keys(problemTitles).sort());
    expect(new Set(errorKinds).size).toBe(errorKinds.length);
  });

  it('cannot be changed', () => {
    expect(Object.isFrozen(errorKinds)).toBe(true);
  });
});
