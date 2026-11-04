import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderModuleManifest, scanModuleDirectory, version } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { library } from './index.ts';

const SOURCE = new URL('modules/library/src/', import.meta.url);

describe('the library fixture module', () => {
  test('its committed manifest is what the directories generate', () => {
    const files = readdirSync(SOURCE, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(fileURLToPath(SOURCE), join(entry.parentPath, entry.name)));
    const scanned = scanModuleDirectory(files);
    expect(scanned.unplaced).toEqual([]);
    const text = renderModuleManifest({
      id: 'library',
      generatorVersion: version,
      scanned,
      migrations: false,
    });
    expect(readFileSync(new URL('module.generated.ts', SOURCE), 'utf8')).toBe(text);
  });

  test('mounts the parts under the references their paths give', () => {
    expect(library.id).toBe('library');
    expect(Object.keys(library.entities)).toEqual(['book']);
    expect(library.actions.addBook.ref).toBe('library.addBook');
    expect(library.actions.findByIsbn.ref).toBe('library.findByIsbn');
    expect(Object.keys(library.policies.book ?? {})).toEqual(['readers']);
  });
});
