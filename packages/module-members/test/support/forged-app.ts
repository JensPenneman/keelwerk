import { defineApp } from '@keelwerk/core';
import { members } from '../../src/module.generated.ts';
import { forger } from './forger/module.ts';

/** The members module beside a module whose enricher forges an admin membership of members. */
export const forgedApp = defineApp({ id: 'forged-app', modules: [members, forger] as const });
