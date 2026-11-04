import { defineModule } from '@keelwerk/core';
import type { Demo } from './demo-types.ts';

export const literal = defineModule({ id: 'literal' }); // expect: plugin/named-module-types

export const typed: Demo = defineModule({ id: 'typed' });
