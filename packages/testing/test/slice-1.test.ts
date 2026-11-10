import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkModuleManifest,
  renderModuleManifest,
  scanModuleDirectory,
} from '@keelwerk/core/manifest';
import { afterAll, describe, expect, expectTypeOf, test } from 'vitest';
import { libraryApp } from '../src/fixtures/index.ts';
import { createLocalClient } from '../src/harness/create-local-client.ts';
import { startTestRuntime } from '../src/harness/start-test-runtime.ts';
import { testPrincipal } from '../src/harness/test-principal.ts';
import { expectAllowed } from '../src/policy/expect-allowed.ts';
import { expectDenied } from '../src/policy/expect-denied.ts';
import type { ExpectValidApp, HasAction, HasEntity } from '../src/types/index.ts';

const moduleRoot = fileURLToPath(new URL('../src/fixtures/modules/library', import.meta.url));

const runtime = await startTestRuntime(libraryApp);
afterAll(() => runtime.stop());

const ada = createLocalClient(runtime, { principal: testPrincipal('ada') });
const anonymous = createLocalClient(runtime, { principal: testPrincipal(null) });

describe('slice 1: the library app in process on the in-memory adapter', () => {
  test('the committed manifest of the library module matches its directories', async () => {
    const source = join(moduleRoot, 'src');
    const entries = await readdir(source, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(source, join(entry.parentPath, entry.name)).split(sep).join('/'));
    const id = 'library';
    const text = renderModuleManifest({
      id,
      scanned: scanModuleDirectory(files),
      migrations: existsSync(join(moduleRoot, 'migrations')),
    });
    const check = await checkModuleManifest(join(source, 'module.generated.ts'), id, text);
    expect(check).toEqual({ current: true, problems: [] });
  });

  test('the app composes without problems', () => {
    expect(libraryApp.registry.problems.filter((problem) => problem.severity === 'error')).toEqual(
      [],
    );
    expectTypeOf<ExpectValidApp<typeof libraryApp>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof libraryApp, 'library.book'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<typeof libraryApp, 'library.addBook'>>().toEqualTypeOf<true>();
  });

  test('addBook as a user returns the book id, and findByIsbn returns the row', async () => {
    const added = await ada.invoke('library.addBook', { title: 'Dune', isbn: '978-0441172719' });
    expect(added.bookId).toEqual(expect.any(String));
    const found = await ada.invoke('library.findByIsbn', { isbn: '978-0441172719' });
    expect(found).toEqual({ bookId: added.bookId, title: 'Dune' });
  });

  test('anonymous is unauthenticated', async () => {
    const attempt = await anonymous.attempt('library.addBook', { title: 'Emma', isbn: '1' });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error).toMatchObject({ kind: 'unauthenticated' });
    await expectDenied(anonymous.invoke('library.findByIsbn', { isbn: '1' }));
    await expectAllowed(ada.invoke('library.findByIsbn', { isbn: '1' }));
  });

  test('a second book with the same ISBN is library.isbn_taken', async () => {
    await ada.invoke('library.addBook', { title: 'Emma', isbn: 'isbn-emma' });
    const second = await ada.attempt('library.addBook', { title: 'Emma II', isbn: 'isbn-emma' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatchObject({ code: 'library.isbn_taken' });
  });

  test('the second tenant sees nothing', async () => {
    const globex = ada.as({ tenant: 'globex' });
    await ada.invoke('library.addBook', { title: 'Ulysses', isbn: 'isbn-ulysses' });
    expect(await globex.invoke('library.findByIsbn', { isbn: 'isbn-ulysses' })).toEqual({});
    expect(await ada.invoke('library.findByIsbn', { isbn: 'isbn-ulysses' })).toMatchObject({
      title: 'Ulysses',
    });
    const again = await globex.invoke('library.addBook', {
      title: 'Ulysses',
      isbn: 'isbn-ulysses',
    });
    expect(again.bookId).toEqual(expect.any(String));
  });
});
