import { buildRegistry } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { conformanceApp, libraryApp } from './index.ts';

describe('the library fixture app', () => {
  const registry = buildRegistry(libraryApp);

  test('composes at runtime without a problem', () => {
    expect(registry.problems).toEqual([]);
    expect(registry.app).toBe('library');
    expect(registry.modules.map((module) => module.id)).toEqual(['core', 'library']);
  });

  test('holds the book, its two actions and its rules', () => {
    expect([...registry.entities.keys()].filter((ref) => ref.startsWith('library.'))).toEqual([
      'library.book',
    ]);
    expect(registry.entities.get('library.book')?.descriptor.table).toBe('library__book');
    expect(registry.entities.get('library.book')?.generated).toEqual([
      'get',
      'query',
      'changes',
      'queryChanges',
      'create',
      'update',
      'archive',
      'restore',
      'set',
      'history',
    ]);
    expect(registry.actions.get('library.addBook')?.kind).toBe('command');
    expect(registry.actions.get('library.findByIsbn')?.kind).toBe('query');
    expect([...registry.rules.keys()].filter((id) => id.startsWith('library.'))).toEqual([
      'library.addBook.signedIn',
      'library.book.readers',
      'library.book.writers',
      'library.findByIsbn.signedIn',
    ]);
  });
});

describe('the conformance fixture app', () => {
  const registry = buildRegistry(conformanceApp);

  test('composes at runtime without a problem', () => {
    expect(registry.problems).toEqual([]);
    expect(registry.modules.map((module) => module.id)).toEqual(['core', 'library', 'loans']);
  });

  test('loans contributes to the library: a field, an entity action and a rule', () => {
    expect(registry.contributions).toMatchObject([
      {
        id: 'loans->library',
        from: 'loans',
        to: 'library',
        active: true,
        fields: { 'library.book': ['reservedBy'] },
        actions: ['library.book.reserve'],
        rules: ['loans.library.book.reservers'],
      },
    ]);
    expect(registry.entities.get('library.book')?.origin).toEqual({ reservedBy: 'loans' });
    expect(registry.entities.get('library.book')?.tracks.map((track) => track.track)).toEqual([
      'library',
      'loans->library',
    ]);
    const reserve = registry.actions.get('library.book.reserve');
    expect(reserve).toMatchObject({ contributedBy: 'loans', instance: true, mount: 'entity' });
  });

  test('the conditional part for the library is active and the one for live is dropped', () => {
    expect(registry.entities.get('loans.loan')?.descriptor.fields.bookId?.ref).toEqual({
      entity: 'library.book',
      foreignKey: true,
    });
    expect(registry.reactions.get('loans.countLoans')).toMatchObject({
      timing: 'inline',
      when: ['library'],
      contributedBy: 'loans',
    });
    expect(registry.actions.has('loans.loanEvents')).toBe(false);
  });

  test('the execution modes follow the actions and the app override', () => {
    expect(registry.actions.get('loans.lend')?.execution).toBe('sync');
    expect(registry.actions.get('loans.closeAll')?.execution).toBe('async');
  });

  test('a maskable field is flagged and read rules list only such fields', () => {
    expect(registry.entities.get('loans.loan')?.descriptor.fields.note?.maskable).toBe(true);
    expect(registry.rules.get('loans.loan.borrowers')).toMatchObject({
      actions: ['read'],
      fields: ['note'],
      disabled: false,
    });
  });
});
