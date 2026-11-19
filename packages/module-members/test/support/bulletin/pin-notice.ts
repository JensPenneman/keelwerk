import { defineCommand, field, shape } from '@keelwerk/core';
import { bulletinBase } from './base.ts';

const pinNoticeDef = defineCommand(bulletinBase, {
  input: shape({ text: field.string() }),
  output: shape({ pinned: field.boolean() }),
  execution: 'sync',
  decide: () => ({ result: { pinned: true } }),
});

type PinNoticePart = typeof pinNoticeDef;
/** The action's type, named once so the rule and the manifest do not repeat it. */
export interface PinNotice extends PinNoticePart {}
export const pinNotice: PinNotice = pinNoticeDef;
