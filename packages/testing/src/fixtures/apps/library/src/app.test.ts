import { expect, test } from 'vitest';
import { library } from './app.ts';

test('the library fixture app carries its composed registry', () => {
  expect(library.registry.app).toBe('library');
  expect(library.registry.entities.has('library.book')).toBe(true);
  expect(library.registry.actions.has('library.addBook')).toBe(true);
  expect(library.registry.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
});
