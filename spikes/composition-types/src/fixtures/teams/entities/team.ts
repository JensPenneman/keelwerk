import { defineEntity } from '../../../define-entity.ts';
import { field } from '../../../field.ts';

export const team = defineEntity({ prefix: 'team', fields: { name: field.string() } });
