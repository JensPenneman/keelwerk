import { defineEffect, field, shape } from '@keelwerk/core';
import { githubBase } from './github-base.ts';

/** GitHub's code exchange: the one inline effect of the connection flow. */
export const exchangeCode = defineEffect(githubBase, {
  input: shape({ code: field.string() }),
  output: shape({
    accountLogin: field.string(),
    token: field.string(),
    scopes: field.string(),
  }),
});
