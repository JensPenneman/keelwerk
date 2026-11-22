import type { FakeHostOptions } from './fake-host.ts';

/** What a fake host answers when the doctor command asks for the pnpm version, the one process it starts through the host: `version`, and any other process is an error. */
export function pnpmAnswerOf(version: string): NonNullable<FakeHostOptions['spawn']> {
  return (command, args, options) => {
    if (command !== 'pnpm' || args.join(' ') !== '--version') {
      throw new Error(`the doctor command started ${command} ${args.join(' ')}`);
    }
    options.onStdout?.(`${version}\n`);
    return { exited: Promise.resolve({ code: 0, signal: null }), kill: () => undefined };
  };
}

/** The version the conventions fixture pins, so the environment check has nothing to say. */
export const pnpmAnswer = pnpmAnswerOf('11.21.0');
