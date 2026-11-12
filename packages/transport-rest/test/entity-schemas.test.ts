import type { SurfaceEntity } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { entitySchemas } from '../src/openapi/entity-schemas.ts';

const base = { optional: false, access: 'read-write' } as const;
const entity: SurfaceEntity = {
  ref: 'board.card',
  module: 'board',
  name: 'card',
  prefix: 'card',
  history: 'chain',
  tenancy: 'tenant',
  fields: {
    id: { ...base, access: 'read', kind: 'id', target: 'board.card', prefix: 'card' },
    title: { ...base, kind: 'string' },
    shown: { ...base, kind: 'boolean', default: true },
  },
  relations: {},
  generated: ['create', 'update'],
  page: { sortable: [], defaultSort: [], defaultSize: 25, maxSize: 100 },
  origin: {},
};

describe('the schemas of an entity', () => {
  const schemas = entitySchemas(entity);
  const named = (suffix: string) =>
    Object.entries(schemas).find(([name]) => name.endsWith(suffix))?.[1] as {
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
    };

  test('the patch schema names no default and requires nothing', () => {
    const patch = named('Patch');
    expect(patch.required).toBeUndefined();
    expect(patch.properties.shown).not.toHaveProperty('default');
    expect(patch.properties.title).toBeDefined();
  });

  test('the create schema keeps the default and leaves the defaulted member out of required', () => {
    const create = named('Create');
    expect(create.properties.shown).toHaveProperty('default', true);
    expect(create.required ?? []).not.toContain('shown');
    expect(create.required).toContain('title');
  });
});
