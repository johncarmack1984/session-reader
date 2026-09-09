/** Remove ANSI escape sequences (colors, cursor movement) from terminal output. */
export function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b[@-Z\\-_]/g, '');
}
