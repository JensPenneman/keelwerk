import type { EntityDescriptor } from '@keelwerk/core';
import { conformanceEntity } from './conformance-entity.ts';
import { conformanceField } from './conformance-field.ts';

/** The sealed kinds: credential material is stored as a sealed value and never compared. */
export const conformanceCredential: EntityDescriptor = conformanceEntity(
  'conf.credential',
  'tenant',
  {
    label: conformanceField('string', 'label'),
    token: conformanceField('secret', 'token', { sealed: true }),
    verifier: conformanceField('verifier', 'verifier', { sealed: true }),
  },
);
