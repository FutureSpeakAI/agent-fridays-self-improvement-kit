# self-improving-agent

> Controlled self-modification for AI agents — read, diff, and propose changes to source code with mandatory human approval.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

An AI agent that can read its own source code, generate diffs, and propose targeted modifications — but **never writes a single byte without explicit human approval**. This is the safety-first approach to agent self-improvement: the agent reasons about what to change and why, generates a clean diff, and presents it for review. Only after the human says "yes" does the change land.

**Zero dependencies. Framework-agnostic. Human always in the loop.**

---

## Origin

Extracted from [Agent Friday](https://github.com/FutureSpeakAI) — an AGI OS by **FutureSpeak.AI**. The self-improvement system is one of several novel subsystems that give Agent Friday the ability to evolve its own capabilities while maintaining strict human oversight. This library packages the core self-modification engine as a standalone, framework-agnostic module.

---

## Install

```bash
npm install self-improving-agent
```

---

## Quick Start

```typescript
import { SelfImproveEngine, ApprovalHandler } from 'self-improving-agent';

// 1. Implement your approval handler — the human-in-the-loop gate
const approve: ApprovalHandler = async (proposal) => {
  console.log(`Change proposed: ${proposal.description}`);
  console.log(proposal.diff);
  return confirm('Apply this change?');  // Your UI here
};

// 2. Create the engine
const engine = new SelfImproveEngine(
  { projectRoot: '/path/to/my-agent' },
  approve,
);

// 3. Let the agent read its own code
const source = await engine.readFile('src/personality.ts');

// 4. Let the agent propose a change (approval required!)
const result = await engine.proposeChange(
  'src/personality.ts',
  modifiedSource,
  'Add humor parameter to personality config',
);
console.log(result); // { approved: true, message: 'Change approved and applied' }
```

---

## How It Works

```
┌──────────────┐     ┌───────────────┐     ┌──────────────────┐
│  AI Agent     │────▶│  Self-Improve  │────▶│  Approval Handler │
│  (reasoning)  │     │  Engine        │     │  (human review)   │
└──────────────┘     └───────────────┘     └──────────────────┘
                            │                        │
                     read_own_source          approve / deny
                     list_own_files                  │
                     propose_code_change             ▼
                            │               ┌──────────────────┐
                            └──────────────▶│  File System      │
                                            │  (write if OK)    │
                                            └──────────────────┘
```

1. **Agent reads** its own source with `readFile()` or `listFiles()` — no approval needed
2. **Agent proposes** a change with `proposeChange()` — generates diff automatically
3. **Human reviews** the diff via your `ApprovalHandler` implementation
4. **If approved**, the engine writes the file and triggers hot-reload handlers
5. **If denied**, nothing happens — the codebase is untouched

---

## Safety Model

| Action | Approval Required? |
|--------|-------------------|
| Read source files | No |
| List directories | No |
| Propose a change | **Yes — always** |
| Write to disk | **Only after approval** |
| Hot-reload modules | Automatic after approved write |

### Path Security

- **Project root containment** — All paths are resolved relative to the project root. Paths that escape the root are rejected.
- **Protected paths** — `node_modules`, `.git`, `dist`, and other sensitive directories are off-limits by default.
- **Extension allowlist** — Only configured file types can be read or written.
- **Timeout** — If the human doesn't respond within the timeout window (default: 60s), the proposal is automatically denied.

---

## API

### `new SelfImproveEngine(config, approvalHandler)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `SelfImproveConfig` | Project root, allowed extensions, protected paths |
| `approvalHandler` | `ApprovalHandler` | Your human-in-the-loop implementation |

### `SelfImproveConfig`

| Option | Default | Description |
|--------|---------|-------------|
| `projectRoot` | (required) | Root directory of the project |
| `allowedExtensions` | `.ts .tsx .js .jsx .json .css .html .md` | File types the agent can access |
| `protectedPaths` | `node_modules .git dist out package-lock.json` | Paths that are off-limits |
| `approvalTimeoutMs` | `60000` | Timeout for human approval |

### Methods

| Method | Description |
|--------|-------------|
| `readFile(path)` | Read a project file (no approval needed) |
| `listFiles(dirPath)` | List files in a project directory |
| `proposeChange(path, content, description)` | Propose a code change (approval required) |
| `generateDiff(original, modified, path)` | Generate a unified diff between two strings |
| `validatePath(path)` | Check if a path is allowed |
| `registerHotReload(pattern, handler)` | Register a reload handler for file patterns |
| `invalidateModuleCache(path)` | Clear Node.js require cache for a module |

### `getSelfImproveTools(agentName?)`

Returns LLM tool declarations for `read_own_source`, `list_own_files`, and `propose_code_change`. Compatible with OpenAI, Gemini, Claude, and any LLM that supports function calling.

```typescript
import { getSelfImproveTools } from 'self-improving-agent';

const tools = getSelfImproveTools('My Agent');
// Pass to your LLM's tool/function declarations
```

---

## Approval Handler Examples

### CLI Prompt

```typescript
import * as readline from 'readline';

const cliApproval: ApprovalHandler = async (proposal) => {
  console.log(`\nProposed change to: ${proposal.filePath}`);
  console.log(proposal.diff);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Apply? (y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
};
```

### GUI Dialog (Electron)

```typescript
const guiApproval: ApprovalHandler = async (proposal) => {
  mainWindow.webContents.send('self-improve:propose', proposal);
  return new Promise((resolve) => {
    ipcMain.once('self-improve:response', (_, approved) => resolve(approved));
  });
};
```

### Always Deny (read-only mode)

```typescript
const readOnly: ApprovalHandler = async () => false;
```

---

## Hot Reload

Register handlers that fire after a file is successfully written:

```typescript
engine.registerHotReload('personality.ts', async () => {
  // Reload the personality module
  engine.invalidateModuleCache('src/personality.ts');
  const { personality } = require('./src/personality');
  personality.reload();
});

engine.registerHotReload('config.json', async () => {
  // Reload configuration
  const config = JSON.parse(await engine.readFile('config.json'));
  applyConfig(config);
});
```

---

## Design Philosophy

1. **Human sovereignty** — The agent can reason about self-modification, but the human always has final say. No exceptions, no overrides, no "auto-approve" mode.

2. **Read freely, write carefully** — Reading source code is unrestricted (the agent needs to understand itself). Writing requires the full approval pipeline.

3. **Transparent diffs** — Every proposed change comes with a unified diff. The human sees exactly what will change — no black-box modifications.

4. **Path containment** — The agent cannot escape its project root, cannot touch protected directories, and cannot write to arbitrary file types.

5. **Graceful degradation** — If approval times out or the handler throws, the change is denied. The system fails safe.

---

## License

MIT — see [LICENSE](./LICENSE).

Built by [FutureSpeak.AI](https://futurespeak.ai) as part of [Agent Friday](https://github.com/FutureSpeakAI), the world's first AGI OS.
