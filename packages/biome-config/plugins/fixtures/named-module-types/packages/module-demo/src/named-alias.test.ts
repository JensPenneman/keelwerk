import { defineModuleBase } from '@keelwerk/core';
import type { HiddenBase } from './hidden-types.ts';

const hidden = defineModuleBase({ id: 'hidden' });
export const shown: HiddenBase = hidden;
