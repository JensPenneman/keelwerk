import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { maxReactionDepth } from './max-reaction-depth.ts';

/** `internal`, `core.reaction_depth`: a chain went deeper than `maxReactionDepth`. */
export function reactionDepthError(what: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.reaction_depth',
    message: `${what} nests deeper than ${String(maxReactionDepth)} levels.`,
    details: { limit: maxReactionDepth },
  });
}
