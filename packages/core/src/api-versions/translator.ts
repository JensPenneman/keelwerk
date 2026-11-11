/** One custom transform of a version change: older to newer for input, newer to older for output. */
export type Translator = (value: unknown) => unknown;
