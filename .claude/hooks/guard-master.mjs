// PreToolUse hook: any command that could ship to master needs the user's explicit OK.
// CLAUDE.md: never push or merge to master without the user's go AND a passing security review.
import { execSync } from 'node:child_process';

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const cmd = String(input?.tool_input?.command || '');
  if (!cmd) process.exit(0);

  let branch = '';
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: input.cwd || process.cwd(), stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {}
  const onMaster = branch === 'master';

  const reasons = [];
  if (/deploy\.bat/i.test(cmd)) reasons.push('runs deploy.bat (merges dev into master and pushes)');
  if (/\bgit\b[^\n;&|]*\bpush\b/.test(cmd) && (/\bmaster\b/.test(cmd) || onMaster))
    reasons.push('pushes to master');
  if (/\bgit\b[^\n;&|]*\b(checkout|switch)\b[^\n;&|]*\bmaster\b/.test(cmd))
    reasons.push('switches to master');
  if (/\bgit\b[^\n;&|]*\b(merge|rebase|reset|cherry-pick)\b/.test(cmd) && onMaster)
    reasons.push('rewrites master (current branch is master)');
  if (/\bgh\s+pr\s+merge\b/.test(cmd)) reasons.push('merges a PR');

  if (!reasons.length) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason:
        `Master guard: this command ${reasons.join('; ')}. ` +
        'Requires your go AND a passing security-auditor review first.',
    },
  }));
});
