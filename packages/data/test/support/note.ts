import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';
import { stringField } from './string-field.ts';

export const note: EntityDescriptor = entityOf(
  'app.note',
  'app__note',
  'tenant',
  {
    title: fieldOf('string', 'title'),
    body: fieldOf('text', 'body'),
    count: fieldOf('integer', 'count'),
    big: fieldOf('integer', 'big', { constraints: { wide: true } }),
    price: fieldOf('decimal', 'price', { constraints: { precision: 10, scale: 2 } }),
    ratio: fieldOf('float', 'ratio'),
    done: fieldOf('boolean', 'done'),
    due: fieldOf('date', 'due'),
    at: fieldOf('instant', 'at'),
    teamId: fieldOf('ref', 'team_id'),
    tags: fieldOf('set', 'tags', { inner: stringField }),
    labels: fieldOf('list', 'labels', { inner: stringField }),
    data: fieldOf('json', 'data'),
    blob: fieldOf('binary', 'blob'),
    secret: fieldOf('secret', 'secret', { sealed: true }),
    email: fieldOf('string', 'email', {
      personal: {
        subject: 'id',
        queries: ['eq', 'prefix'],
        normalize: { id: 'email', version: 1 },
        params: {
          eq: { bits: 128 },
          prefix: { min: 3, max: 30 },
          contains: { bits: 64 },
          order: { bytes: 8 },
        },
        keys: 'tenant',
      },
    }),
  },
  {
    team: { kind: 'one', target: 'app.team', by: 'id', to: 'teamId', contributedBy: null },
    watchers: {
      kind: 'many',
      target: 'app.member',
      by: 'teamId',
      to: 'teamId',
      contributedBy: null,
    },
  },
  { emailEq: { field: 'email', kind: 'binary', query: 'eq', column: 'email__eq', keyVersion: 1 } },
);
