/**
 * self-improving-agent — Basic Usage Example
 *
 * Shows how to wire an approval handler and let the agent
 * read/modify its own source code.
 *
 * Run: npx ts-node examples/basic-usage.ts
 */

import * as readline from 'readline';
import {
  SelfImproveEngine,
  ApprovalHandler,
  ChangeProposal,
  getSelfImproveTools,
} from '../src';

// ── 1. Implement an approval handler ─────────────────────────────────
// This is the safety gate. The user must approve every change.

const cliApproval: ApprovalHandler = async (proposal: ChangeProposal): Promise<boolean> => {
  console.log('\n┌──────────────────────────────────────────────────┐');
  console.log('│  📝 SELF-MODIFICATION PROPOSAL                   │');
  console.log('└──────────────────────────────────────────────────┘');
  console.log(`\nFile: ${proposal.filePath}`);
  console.log(`Description: ${proposal.description}`);
  console.log('\n--- Diff ---');
  console.log(proposal.diff);
  console.log('--- End ---\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Apply this change? (y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
};

// ── 2. Create the engine ──────────────────────────────────────────────

const engine = new SelfImproveEngine(
  {
    projectRoot: process.cwd(),
    allowedExtensions: ['.ts', '.js', '.json', '.md'],
    protectedPaths: ['node_modules', '.git', 'dist'],
    approvalTimeoutMs: 120_000,  // 2 minutes
  },
  cliApproval,
);

// ── 3. Register hot-reload handlers (optional) ────────────────────────

engine.registerHotReload('config.json', async () => {
  console.log('[Hot Reload] config.json changed — reloading...');
  // Your app-specific reload logic here
});

// ── 4. Use the engine ─────────────────────────────────────────────────

async function main() {
  // Read a file
  try {
    const content = await engine.readFile('package.json');
    console.log('Read package.json:', content.slice(0, 100) + '...');
  } catch (err) {
    console.log('Could not read package.json:', err);
  }

  // List files
  try {
    const files = await engine.listFiles('.');
    console.log('\nProject root:', files.slice(0, 10));
  } catch (err) {
    console.log('Could not list files:', err);
  }

  // Propose a change (will show diff and ask for approval)
  const result = await engine.proposeChange(
    'examples/test-output.md',
    '# Self-Improvement Log\n\nThe agent modified this file as a test.\n',
    'Create a test file to verify the self-improvement pipeline works.',
  );

  console.log('\nResult:', result);

  // Get tool declarations for your LLM
  const tools = getSelfImproveTools('My Agent');
  console.log('\nTool declarations for LLM:', tools.map(t => t.name));
}

main().catch(console.error);
