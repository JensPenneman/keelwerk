import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';

const bulletinBaseDef = defineModuleBase({ id: 'bulletin', version: '0.0.0' });

export interface BulletinBase extends ModuleBaseType<typeof bulletinBaseDef> {}
export const bulletinBase: BulletinBase = bulletinBaseDef;
