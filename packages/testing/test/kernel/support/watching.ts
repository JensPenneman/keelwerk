/** What `target` does, with `replace` answering the members it names; every method keeps its owner. */
export function watching<T extends object>(
  target: T,
  replace: Partial<Record<keyof T, unknown>>,
): T {
  return new Proxy(target, {
    get: (object, name) => {
      if (Object.hasOwn(replace, name)) return replace[name as keyof T];
      const member: unknown = Reflect.get(object, name, object);
      return typeof member === 'function' ? member.bind(object) : member;
    },
  });
}
