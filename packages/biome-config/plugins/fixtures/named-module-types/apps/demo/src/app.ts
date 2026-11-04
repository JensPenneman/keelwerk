import { defineApp } from '@keelwerk/core';
import type { Demo } from './demo-types.ts';

export const demoApp = defineApp({ id: 'demo' }) satisfies Demo; // expect: plugin/named-module-types

export const namedApp: Demo = defineApp({ id: 'named' });
