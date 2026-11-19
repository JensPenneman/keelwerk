/** A hand-written app type of subscriptions whose event has no value, an optional value or a plain value. */
export interface TrpcEventApp {
  readonly '~types'?: {
    readonly tree: {
      readonly pulse: {
        readonly actions: {
          readonly tick: {
            readonly kind: 'subscription';
            readonly input: undefined;
            // biome-ignore lint/suspicious/noConfusingVoidType: the action tree writes an empty output as void
            readonly output: void;
            readonly errors: never;
            readonly events: never;
            readonly execution: undefined;
          };
          readonly maybe: {
            readonly kind: 'subscription';
            readonly input: undefined;
            readonly output: string | undefined;
            readonly errors: never;
            readonly events: never;
            readonly execution: undefined;
          };
          readonly text: {
            readonly kind: 'subscription';
            readonly input: undefined;
            readonly output: string;
            readonly errors: never;
            readonly events: never;
            readonly execution: undefined;
          };
        };
        readonly entities: Record<never, never>;
      };
    };
  };
}
