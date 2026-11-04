/**
 * The module whose context built each request of one invocation. The interpreter reads a load's
 * authority from here and never from a member of the request, so a part cannot claim another
 * module's authority by building a request itself.
 */
export type RequestAuthorities = WeakMap<object, string>;
