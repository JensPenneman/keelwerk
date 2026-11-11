import { defineTopic, field, shape } from '@keelwerk/core';
import { m2PartsBase } from '../base.ts';

export const progress = defineTopic(m2PartsBase, {
  key: shape({ task: field.ref.own('task') }),
  record: shape({ step: field.integer() }),
});
