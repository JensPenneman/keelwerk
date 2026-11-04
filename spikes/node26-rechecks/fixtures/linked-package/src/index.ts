export interface Greeting {
  readonly text: string;
}

export const greet = (name: string): Greeting => ({ text: `hello ${name}` });
