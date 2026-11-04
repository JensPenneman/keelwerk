import type { EntityDescriptor } from '@keelwerk/core';
import { conformanceEntity } from './conformance-entity.ts';
import { conformanceField } from './conformance-field.ts';

/**
 * One field of every kind the codecs store except the sealed ones (`conf.credential`) and the
 * serial (`conf.ticket`). `ownerId` is a hard reference: a foreign key towards `conf.owner`.
 */
export const conformanceKitchen: EntityDescriptor = conformanceEntity(
  'conf.kitchen',
  'tenant',
  {
    name: conformanceField('string', 'name'),
    notes: conformanceField('text', 'notes'),
    count: conformanceField('integer', 'count'),
    wide: conformanceField('integer', 'wide', { constraints: { wide: true } }),
    price: conformanceField('decimal', 'price', { constraints: { precision: 20, scale: 4 } }),
    ratio: conformanceField('float', 'ratio'),
    flag: conformanceField('boolean', 'flag'),
    happened: conformanceField('instant', 'happened'),
    day: conformanceField('date', 'day'),
    zone: conformanceField('timeZone', 'zone'),
    mood: conformanceField('enum', 'mood', { constraints: { values: ['calm', 'busy', 'away'] } }),
    payload: conformanceField('json', 'payload'),
    ownerId: conformanceField('ref', 'owner_id', {
      ref: { entity: 'conf.owner', foreignKey: true },
    }),
    who: conformanceField('subject', 'who'),
    tags: conformanceField('set', 'tags', { inner: conformanceField('string', 'element') }),
    scores: conformanceField('list', 'scores', {
      inner: conformanceField('integer', 'element', { constraints: { wide: true } }),
    }),
    story: conformanceField('richText', 'story', { codec: 'loro/1' }),
    raw: conformanceField('binary', 'raw'),
    attachment: conformanceField('blob', 'attachment'),
  },
  {
    owner: { kind: 'one', target: 'conf.owner', by: 'id', to: 'ownerId', contributedBy: null },
  },
);
