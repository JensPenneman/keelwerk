import { commonFlags } from '../../routes/common-flags.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';

function text(brief: string, placeholder: string, variadic = false): FlagParameter {
  return variadic
    ? ({
        kind: 'parsed',
        parse: String,
        brief,
        placeholder,
        optional: true,
        variadic: true,
      } as unknown as FlagParameter)
    : ({
        kind: 'parsed',
        parse: String,
        brief,
        placeholder,
        optional: true,
      } as unknown as FlagParameter);
}

/** The flags of `explain` (section 16.9.7): the connection and output flags every command shares, then its own. */
export function explainFlags(): Readonly<Record<string, FlagParameter>> {
  const common = commonFlags();
  return {
    profile: common.profile,
    backend: common.backend,
    tenant: common.tenant,
    socket: common.socket,
    config: common.config,
    output: common.output,
    fields: common.fields,
    input: common.input,
    'command-id': common['command-id'],
    as: text('Evaluate as this principal: kind[:id], for example user:ada.', 'principal'),
    roles: text('The roles of the --as principal, comma separated.', 'a,b'),
    'dry-run': {
      kind: 'boolean',
      brief: 'Run admission, prepare and decide in a unit that rolls back.',
      optional: true,
      withNegated: false,
    } as unknown as FlagParameter,
    trace: text('Print the tree of a command, event or effect id.', 'id'),
    answer: text(
      'The outcome of an inline effect for a dry run: <effect>=<json>; repeatable.',
      'effect=json',
      true,
    ),
  } as Readonly<Record<string, FlagParameter>>;
}
