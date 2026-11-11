import { defineStream, field, shape } from '@keelwerk/core';

export const log = defineStream({
  key: field.ref.own('task'),
  record: shape({ line: field.string() }),
  readAs: 'task',
});
