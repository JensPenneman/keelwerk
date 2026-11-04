import { defineEffect, field, shape } from '@keelwerk/core';
import { hooksBase } from '../base.ts';

export const post = defineEffect(hooksBase, {
  input: shape({
    url: field.string({ format: 'uri' }),
    signingKey: field.secret(),
    body: field.text(),
  }),
  output: shape({ status: field.integer() }),
});
