import { defineApp } from '@keelwerk/core';
import type { Demo } from './demo-types.ts';

export const demo = defineApp({ id: 'demo' }) as Demo; // expect: plugin/named-module-types
