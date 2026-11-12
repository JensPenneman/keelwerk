/** What a key may do: `read` reads, `write` also runs commands, `transport:<id>` binds it to a listener. */
export type KeyScope = 'read' | 'write' | `transport:${string}`;
