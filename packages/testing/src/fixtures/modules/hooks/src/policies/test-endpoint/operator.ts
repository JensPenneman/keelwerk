import { defineRule } from '@keelwerk/core';
import { testEndpoint } from '../../actions/test-endpoint.ts';
import { hooksBase } from '../../base.ts';

export const operator = defineRule(hooksBase, testEndpoint, {
  effect: 'allow',
  principal: 'operator',
});
