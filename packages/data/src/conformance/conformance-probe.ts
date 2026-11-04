import type { EntityDescriptor } from '@keelwerk/core';
import { conformanceEntity } from './conformance-entity.ts';
import { conformanceField } from './conformance-field.ts';

const text = conformanceField('string', 'element');
const count = conformanceField('integer', 'element');

/**
 * The entity the dual-evaluation cases filter: one plaintext field of each kind a condition may
 * test, and a soft reference (no foreign key) so rows may name an owner that does not exist.
 */
export const conformanceProbe: EntityDescriptor = conformanceEntity(
  'conf.probe',
  'tenant',
  {
    label: conformanceField('string', 'label'),
    note: conformanceField('text', 'note'),
    n: conformanceField('integer', 'n'),
    price: conformanceField('decimal', 'price', { constraints: { precision: 10, scale: 2 } }),
    ratio: conformanceField('float', 'ratio'),
    flag: conformanceField('boolean', 'flag'),
    at: conformanceField('instant', 'at'),
    day: conformanceField('date', 'day'),
    mood: conformanceField('enum', 'mood', { constraints: { values: ['calm', 'busy', 'away'] } }),
    tags: conformanceField('set', 'tags', { inner: text }),
    scores: conformanceField('list', 'scores', { inner: count }),
    raw: conformanceField('binary', 'raw'),
    payload: conformanceField('json', 'payload'),
    ownerId: conformanceField('ref', 'owner_id', {
      ref: { entity: 'conf.owner', foreignKey: false },
    }),
  },
  {
    owner: { kind: 'one', target: 'conf.owner', by: 'id', to: 'ownerId', contributedBy: null },
  },
);
