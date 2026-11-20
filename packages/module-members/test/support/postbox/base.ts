import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { members } from '../../../src/module.generated.ts';
import { toMembers } from './to-members.ts';

const postboxBaseDef = defineModuleBase({
  id: 'postbox',
  version: '0.0.0',
  requires: [members],
  contributions: { toMembers },
});

export interface PostboxBase extends ModuleBaseType<typeof postboxBaseDef> {}
export const postboxBase: PostboxBase = postboxBaseDef;
