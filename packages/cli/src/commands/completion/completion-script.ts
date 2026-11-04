export type CompletionShell = 'bash' | 'zsh' | 'fish';

/** A completion script that asks the binary: `keelwerk __complete <words>` prints one proposal per line. */
export function completionScript(shell: CompletionShell): string {
  switch (shell) {
    case 'bash':
      return [
        '_keelwerk_complete() {',
        "  local IFS=$'\\n'",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax, not a template
        '  COMPREPLY=($(keelwerk __complete "${COMP_WORDS[@]:1:$COMP_CWORD}" 2>/dev/null))',
        '}',
        'complete -F _keelwerk_complete keelwerk',
      ].join('\n');
    case 'zsh':
      return [
        '#compdef keelwerk',
        '_keelwerk() {',
        '  local -a proposals',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax, not a template
        '  proposals=("${(@f)$(keelwerk __complete "${(@)words[2,CURRENT]}" 2>/dev/null)}")',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax, not a template
        '  compadd -- "${proposals[@]}"',
        '}',
        'compdef _keelwerk keelwerk',
      ].join('\n');
    case 'fish':
      return [
        'function __keelwerk_complete',
        '  set -l words (commandline -opc)[2..-1] (commandline -ct)',
        '  keelwerk __complete $words 2>/dev/null',
        'end',
        "complete -c keelwerk -f -a '(__keelwerk_complete)'",
      ].join('\n');
  }
}
