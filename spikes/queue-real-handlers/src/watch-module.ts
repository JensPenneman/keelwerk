import {
  defineModule,
  defineModuleBase,
  defineReaction,
  type ModuleBaseType,
  type ModuleType,
} from '@keelwerk/core';
import { bench } from './bench-module.ts';
import { watchMark } from './watch-mark.ts';

const watchBaseDef = defineModuleBase({
  id: 'watch',
  version: '0.1.0',
  requires: [bench],
  entities: { mark: watchMark },
});

interface WatchBase extends ModuleBaseType<typeof watchBaseDef> {}
const watchBase: WatchBase = watchBaseDef;

/** The reaction job: writes a mark for the item its event created. */
const markItem = defineReaction(watchBase, {
  on: 'bench.item.created',
  *react(event, ctx) {
    const id = yield* ctx.newId(watchMark);
    return { events: [ctx.write.watch.mark.create({ id, itemId: event.stream.id })] };
  },
});

const watchDef = defineModule(watchBase, { reactions: { markItem } });

export interface Watch extends ModuleType<typeof watchDef> {}
export const watch: Watch = watchDef;
