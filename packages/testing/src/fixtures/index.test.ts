import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderModuleManifest, scanModuleDirectory, version } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { library, loans } from './index.ts';

describe.each(['library', 'loans'])('the %s fixture module', (id) => {
  test('its committed manifest is what the directories generate', () => {
    const source = new URL(`modules/${id}/src/`, import.meta.url);
    const files = readdirSync(source, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(fileURLToPath(source), join(entry.parentPath, entry.name)));
    const scanned = scanModuleDirectory(files);
    expect(scanned.unplaced).toEqual([]);
    const text = renderModuleManifest({
      id,
      generatorVersion: version,
      scanned,
      migrations: false,
    });
    expect(readFileSync(new URL('module.generated.ts', source), 'utf8')).toBe(text);
  });
});

describe('the library fixture module', () => {
  test('mounts the parts under the references their paths give', () => {
    expect(library.id).toBe('library');
    expect(Object.keys(library.entities)).toEqual(['book']);
    expect(library.actions.addBook.ref).toBe('library.addBook');
    expect(library.actions.findByIsbn.ref).toBe('library.findByIsbn');
    expect(Object.keys(library.policies.book ?? {})).toEqual(['readers', 'writers']);
  });
});

describe('the loans fixture module', () => {
  test('mounts its parts, contributions and conditional parts under their references', () => {
    expect(loans.id).toBe('loans');
    expect(Object.keys(loans.entities)).toEqual(['loan']);
    expect(loans.actions.lend.execution).toBe('either');
    expect(loans.actions.closeAll.execution).toBe('async');
    expect(loans.actions.lend.ref).toBe('loans.lend');
    expect(loans.contributes.map((part) => part.to.id)).toEqual(['library']);
    expect(loans.conditional.map((part) => part.key)).toEqual(['whenLibrary', 'whenLive']);
  });
});
