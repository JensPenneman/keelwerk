import { expect, test } from 'vitest';
import { memoryM2Collections } from './memory-m2-collections.ts';

const m1Prefixes = [
  'buckets',
  'events',
  'groups',
  'history',
  'jobs',
  'lanes',
  'pos',
  'rows',
  'scopekeys',
  'serials',
  'streamv',
  'subjectkeys',
  'subjectrefs',
  'usage',
  'valuekeys',
];

test('the M2 collection names are distinct and the scoped ones carry their scope', () => {
  const names = ['scope-a', 'scope-b'].flatMap((scopeId) =>
    Object.values(memoryM2Collections).map((entry) =>
      typeof entry === 'function' ? entry(scopeId) : entry,
    ),
  );
  const scoped = Object.values(memoryM2Collections).filter((entry) => typeof entry === 'function');
  expect(scoped).toHaveLength(4);
  for (const entry of scoped) {
    expect(entry('scope-a')).toContain('scope-a');
    expect(entry('scope-a')).not.toBe(entry('scope-b'));
  }
  expect(new Set(names)).toHaveProperty('size', 16);
  for (const name of names) {
    expect(m1Prefixes).not.toContain(name.split('/')[0]);
  }
});
