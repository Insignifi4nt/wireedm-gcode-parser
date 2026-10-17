import assert from 'node:assert/strict';

// Names describe the change, never the tool or agent that wrote it.
const branch = process.env.BRANCH ?? '', title = process.env.TITLE ?? '';
const types = ['feature', 'fix', 'design', 'docs', 'ci', 'refactor', 'perf', 'test', 'deps', 'audit', 'release'];
const tools = /\b(claude|codex|copilot|cursor|gpt|chatgpt|gemini|devin|openai|anthropic)\b/i;

assert.match(branch, new RegExp(`^(${types.join('|')})/[a-z0-9]+(-[a-z0-9]+)*$`),
  `Name the branch <type>/<topic> in lowercase kebab case, with type one of: ${types.join(', ')}.`);
assert.doesNotMatch(branch.replaceAll('-', ' ').replaceAll('/', ' '), tools, 'Branch names describe the change, not the tool or agent.');
assert.ok(title.trim().length >= 10, 'Give the pull request a descriptive title.');
assert.doesNotMatch(title, tools, 'Pull request titles describe the change, not the tool or agent.');
assert.doesNotMatch(title, /^\s*\[[^\]]*\]/, 'Do not prefix pull request titles with bracketed tags.');
console.log(`Branch ${branch} and title verified.`);
