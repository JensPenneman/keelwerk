import { defineModuleBase } from '@keelwerk/core';
import type { MailBase } from './mail-types.ts';

const mailBaseDef: MailBase = defineModuleBase({ id: 'mail' });
export const mailBase: typeof mailBaseDef = mailBaseDef; // expect: plugin/named-module-types
