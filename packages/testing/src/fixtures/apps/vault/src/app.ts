import { type AppType, defineApp } from '@keelwerk/core';
import { modules } from './modules.ts';

const vaultDef = defineApp({ id: 'vault', modules });

export interface Vault extends AppType<typeof vaultDef> {}
export const vault: Vault = vaultDef;
