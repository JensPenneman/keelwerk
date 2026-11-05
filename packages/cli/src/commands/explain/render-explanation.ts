function json(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

interface Rule {
  readonly effect: string;
  readonly id: string;
  readonly module: string;
  readonly file: string;
  readonly reason?: string;
}

function decisionLines(value: Readonly<Record<string, unknown>>): string[] {
  const principal = value.principal as { kind: string; id?: string };
  const who = principal.id === undefined ? principal.kind : `${principal.kind} ${principal.id}`;
  const lines = [
    `${String(value.action)} (${String(value.kind)}) for ${who} in ${String(value.scope)}: ${
      value.allowed === true ? 'allowed' : 'denied'
    }`,
  ];
  if (typeof value.reason === 'string') lines.push(`  reason: ${value.reason}`);
  for (const rule of value.rules as readonly Rule[]) {
    lines.push(`  ${rule.effect} ${rule.id}  [${rule.module}] ${rule.file}`);
    if (rule.reason !== undefined) lines.push(`    ${rule.reason}`);
  }
  const plan = value.plan as
    | {
        text: string;
        masks: readonly { field: string; revealedBy: string[]; hiddenBy: string[] }[];
      }
    | undefined;
  if (plan !== undefined) {
    lines.push('plan:', ...plan.text.split('\n').map((line) => `  ${line}`));
    for (const mask of plan.masks) {
      lines.push(
        `  mask ${mask.field}: revealed by ${mask.revealedBy.join(', ') || 'nothing'}` +
          (mask.hiddenBy.length > 0 ? `; hidden by ${mask.hiddenBy.join(', ')}` : ''),
      );
    }
  }
  return lines;
}

function dryRunLines(value: Readonly<Record<string, unknown>>): string[] {
  const report = value.report as Readonly<Record<string, unknown>>;
  const lines = decisionLines(value.authorization as Readonly<Record<string, unknown>>);
  if (report.status === 'would-perform') {
    lines.push(
      `dry run of ${String(report.action)} stops: ${String(report.effect)} would perform ${json(report.input)}`,
      'give its outcome with --answer <effect>=<json> to go on',
    );
    return lines;
  }
  lines.push(
    `dry run of ${String(report.action)} as command ${String(report.commandId)}: nothing was written`,
  );
  lines.push('events:');
  for (const event of report.events as readonly Record<string, unknown>[]) {
    lines.push(`  ${String(event.stream)} v${String(event.version)} ${String(event.type)}`);
    lines.push(`    data: ${json(event.data)}`, `    before: ${json(event.before)}`);
  }
  lines.push('effects:');
  for (const effect of report.effects as readonly Record<string, unknown>[]) {
    const next = effect.continuation === undefined ? '' : ` -> ${String(effect.continuation)}`;
    lines.push(`  ${String(effect.id)} ${String(effect.kind)} ${String(effect.type)}${next}`);
  }
  lines.push(`result: ${json(report.result)}`, `decision record: ${json(report.decision)}`);
  return lines;
}

function commandLines(command: Readonly<Record<string, unknown>>, depth: number): string[] {
  const pad = '  '.repeat(depth);
  const actor = command.actor as { kind: string; id: string | null };
  const lines = [
    `${pad}command ${String(command.commandId)} ${String(command.action ?? 'kernel work')} by ${actor.kind}${actor.id === null ? '' : ` ${actor.id}`}`,
  ];
  for (const event of command.events as readonly Record<string, unknown>[]) {
    lines.push(
      `${pad}  event ${String(event.stream)} v${String(event.version)} ${String(event.type)}  ${String(event.eventId)}`,
    );
  }
  for (const effect of command.effects as readonly Record<string, unknown>[]) {
    lines.push(
      `${pad}  effect ${String(effect.id)} ${String(effect.type ?? '')} ${String(effect.status ?? '')}`.trimEnd(),
    );
    for (const next of effect.continuations as readonly Record<string, unknown>[]) {
      lines.push(...commandLines(next, depth + 2));
    }
  }
  for (const next of command.nested as readonly Record<string, unknown>[]) {
    lines.push(...commandLines(next, depth + 1));
  }
  return lines;
}

/** The terminal form of a `core.explain` answer (section 16.9.7): the decision with its rule files, the dry run's events, effects and record, or the trace's tree. */
export function renderExplanation(value: Readonly<Record<string, unknown>>): string {
  switch (value.mode) {
    case 'decision':
      return decisionLines(value).join('\n');
    case 'dry-run':
      return dryRunLines(value).join('\n');
    case 'trace': {
      const requested = value.requested as { kind: string; id: string };
      return [
        `trace of ${requested.kind} ${requested.id}`,
        ...commandLines(value.command as Readonly<Record<string, unknown>>, 1),
      ].join('\n');
    }
    default:
      return json(value);
  }
}
