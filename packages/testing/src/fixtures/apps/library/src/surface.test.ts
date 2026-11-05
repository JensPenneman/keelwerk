import { readFile } from 'node:fs/promises';
import {
  type ApiSurface,
  defineApp,
  deriveSurface,
  renderAppGeneratedFile,
  renderSurfaceArtefact,
  version,
} from '@keelwerk/core';
import { checkRestSurface } from '@keelwerk/transport-rest';
import { describe, expect, test } from 'vitest';
import { library as libraryModule } from '../../../modules/library/src/module.generated.ts';
import { loans } from '../../../modules/loans/src/module.generated.ts';
import { conformanceApi } from '../../conformance/src/api-versions.ts';
import { conformance } from '../../conformance/src/app.ts';
import { apiVersion as conformanceHead } from '../../conformance/src/keelwerk.generated.ts';
import { library } from './app.ts';
import { apiVersion } from './keelwerk.generated.ts';

const head = '2026-11-04';

function surfaceOf(app: typeof library | typeof conformance, date: string): ApiSurface {
  const derived = deriveSurface(app, date);
  expect(derived.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
  return derived.surface;
}

describe('the library app surface (section 16.2)', () => {
  const surface = surfaceOf(library, head);

  test('is the committed artefact, byte for byte', async () => {
    const committed = await readFile(
      new URL(`../generated/api-surface/library/${head}.json`, import.meta.url),
      'utf8',
    );
    expect(renderSurfaceArtefact(surface)).toBe(committed);
  });

  test('is the committed generated file, apart from the generator version', async () => {
    const committed = await readFile(new URL('./keelwerk.generated.ts', import.meta.url), 'utf8');
    const text = renderAppGeneratedFile({
      generatorVersion: version,
      appFile: './app.ts',
      appType: 'Library',
      apiVersion,
      hash: surface.hash,
      fragments: [],
    });
    expect(committed).toBe(text);
    expect(apiVersion).toBe(head);
  });

  test('passes the REST surface check with no problems', () => {
    expect(checkRestSurface(surface)).toEqual([]);
  });

  test('has the library module, its book entity and its actions, and no hidden field', () => {
    expect(surface.modules.map((module) => module.id)).toEqual(['core', 'library']);
    const book = surface.entities.find((entity) => entity.ref === 'library.book');
    expect(Object.keys(book?.fields ?? {})).toEqual([
      'addedBy',
      'archivedAt',
      'createdAt',
      'id',
      'isbn',
      'relatedTo',
      'title',
      'updatedAt',
      'version',
    ]);
    expect(surface.actions.map((action) => action.ref)).toContain('library.addBook');
    expect(surface.errors.map((error) => error.code)).toContain('library.isbn_taken');
  });
});

describe('the conformance app surface', () => {
  const surface = surfaceOf(conformance, head);

  test('passes the REST surface check with no problems', () => {
    expect(checkRestSurface(surface)).toEqual([]);
  });

  test('is the committed artefact, byte for byte', async () => {
    const committed = await readFile(
      new URL(`../../conformance/generated/api-surface/conformance/${head}.json`, import.meta.url),
      'utf8',
    );
    expect(renderSurfaceArtefact(surface)).toBe(committed);
  });

  test('names its head API version in the generated file', () => {
    expect(conformanceHead).toBe(head);
  });

  test('does not depend on the order of the module tuple', () => {
    const reversed = defineApp({
      id: 'conformance',
      modules: [loans, libraryModule],
      execution: { 'loans.lend': 'sync' },
      api: conformanceApi,
    });
    expect(deriveSurface(reversed, head).surface.hash).toBe(surface.hash);
  });
});
