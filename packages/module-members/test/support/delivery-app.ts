import { defineApp } from '@keelwerk/core';
import { members } from '../../src/module.generated.ts';
import { postbox } from './postbox/module.ts';

/** The members module with a delivery filler, so an invitation's token goes to the filler only. */
export const deliveryApp = defineApp({ id: 'delivery-app', modules: [members, postbox] as const });
