import type { VersionTranslation } from '../api-versions/version-translation.ts';
import { errors } from '../errors/errors.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { LiveFrame } from './live-frame.ts';
import { translate } from './stages/translate.ts';

/** The item of a frame for the API version of the request that opened the stream; control frames pass. */
export function subscriptionItemOf(
  action: ActionEntry,
  translation: VersionTranslation | undefined,
): (frame: LiveFrame<unknown>) => Promise<LiveFrame<unknown>> {
  return async (frame) => {
    if ('control' in frame) return frame;
    let event = frame.event;
    // A custom subscription's items are what its maps made: they must fit the declared event shape.
    // The kernel builds the items of a generated watch.
    if (action.generated === undefined) {
      const result = await action.output['~standard'].validate(event);
      if (result.issues !== undefined) {
        throw errors.internal(`An item of "${action.ref}" does not fit its event shape.`);
      }
      event = result.value;
    }
    const translated = await translate(translation, 'output', action, event);
    return frame.state === undefined
      ? { event: translated }
      : { event: translated, state: frame.state };
  };
}
