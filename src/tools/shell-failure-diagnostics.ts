/**
 * Diagnose a failed shell proof well enough to name the recovery the agent
 * needs. A missing file or a missing interpreter is deterministic: repeating
 * the same command produces the same failure and burns the retry budget
 * (SquadRules/mcp#216).
 */

export type ShellFailureKind = 'missing_file' | 'missing_interpreter';

export interface ShellFailureDiagnosis {
  kind: ShellFailureKind;
  /** What the reported output said, close enough to act on. */
  detail: string;
  /** The recovery the caller must follow before running anything again. */
  recovery: string;
}

const MISSING_FILE_PATTERNS: RegExp[] = [
  /no such file or directory/i,
  /no such file/i,
  /file not found/i,
  /FileNotFoundError/,
  /cannot find the (?:file|path) specified/i,
  /the system cannot find the (?:file|path) specified/i
];

const MISSING_INTERPRETER_PATTERNS: RegExp[] = [
  /command not found/i,
  /is not recognized as an internal or external command/i
];

function firstMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match;
    }
  }
  return null;
}

export function diagnoseShellFailure(
  shell: { stdout?: string; stderr?: string } | undefined
): ShellFailureDiagnosis | null {
  if (!shell) {
    return null;
  }
  const combined = `${shell.stderr ?? ''}\n${shell.stdout ?? ''}`;

  const missingFile = firstMatch(combined, MISSING_FILE_PATTERNS);
  if (missingFile) {
    return {
      kind: 'missing_file',
      detail: `the reported output says a file was not found ("${missingFile[0].trim()}")`,
      recovery:
        'A missing file is deterministic — do NOT run the same command again. ' +
        "Obtain the file first: run the `cmd` of the materialize instruction from the activate choice's linked_artifacts row " +
        'verbatim (on stdio, call the MCP export tool first and put its `content` in $B64), or call `export` for that ' +
        'adapter (format skill_tree for the file list, skill_zip for the bundle) and take the script from artifacts/. ' +
        'If the file is in neither place, the adapter ships no such script: do not create it and do not substitute a ' +
        'different command — report the step as failed with the missing path in stderr and rate the run failure.'
    };
  }

  const missingInterpreter = firstMatch(combined, MISSING_INTERPRETER_PATTERNS);
  if (missingInterpreter) {
    return {
      kind: 'missing_interpreter',
      detail: `the reported output says a command was not found ("${missingInterpreter[0].trim()}")`,
      recovery:
        'A missing command is deterministic — do NOT run the same command again. ' +
        "Check that the contract's interpreter is on PATH (e.g. `which bash`); if it is not, fail with a clear local " +
        'error instead of retrying, and report that the contract needs re-training.'
    };
  }

  return null;
}
