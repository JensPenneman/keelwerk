import { dispatcherMark } from './dispatcher-mark.ts';

/** Whether a consumer, or the builder of one, is the reaction dispatcher: it carries the module-private mark. */
export function isReactionDispatcher(entry: object): boolean {
  return Reflect.get(entry, dispatcherMark) === true;
}
