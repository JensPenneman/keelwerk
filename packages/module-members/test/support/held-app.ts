import { defineApp } from '@keelwerk/core';
import { members } from '../../src/module.generated.ts';
import { hold } from './hold/module.ts';

/** The members module beside a module that can hold the erasures of its service principal. */
export const heldApp = defineApp({ id: 'held-app', modules: [members, hold] as const });
