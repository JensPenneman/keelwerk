import type { InvocationSession } from './invocation-session.ts';
import type { SessionDetails } from './session-details.ts';

/** The sessions one invoker created (section 16.3.4): a foreign object is not in it. */
export interface SessionRegistry {
  register(session: InvocationSession, details: SessionDetails): void;
  /** Undefined for an object this invoker did not create. */
  detailsOf(session: InvocationSession): SessionDetails | undefined;
}

/** A registry that holds sessions weakly, so a dropped session leaves no trace. */
export function createSessionRegistry(): SessionRegistry {
  const known = new WeakMap<object, SessionDetails>();
  return {
    register: (session, details) => {
      known.set(session, details);
    },
    detailsOf: (session) => known.get(session),
  };
}
