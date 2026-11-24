import { defineApp } from '@keelwerk/core';
import { members } from '../../src/module.generated.ts';
import { bulletin } from './bulletin/module.ts';

/** The members module beside a module whose command a member's role admits. */
export const membersApp = defineApp({ id: 'members-app', modules: [members, bulletin] as const });
