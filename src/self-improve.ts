/**
 * self-improving-agent — Core engine for agent self-modification.
 *
 * Allows an AI agent to read its own source code, propose changes,
 * and apply them — with mandatory human approval at every step.
 *
 * Framework-agnostic: no Electron, no specific LLM SDK.
 * Bring your own approval UI (CLI prompt, GUI dialog, Slack, etc.).
 *
 * @module self-improving-agent
 * @see https://github.com/FutureSpeakAI/self-improving-agent
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

import type {
  PendingChange,
  ChangeProposal,
  ChangeResult,
  ApprovalHandler,
  HotReloadHandler,
  SelfImproveConfig,
  ToolDeclaration,
} from './types';

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html', '.md',
]);

const DEFAULT_PROTECTED = new Set([
  'node_modules', '.git', 'dist', 'out', 'package-lock.json',
]);

const DEFAULT_APPROVAL_TIMEOUT = 60_000;

// ── Self-Improve Engine ──────────────────────────────────────────────

export class SelfImproveEngine {
  private projectRoot: string;
  private allowedExtensions: Set<string>;
  private protectedPaths: Set<string>;
  private approvalTimeoutMs: number;
  private approvalHandler: ApprovalHandler;
  private hotReloadHandlers = new Map<string, HotReloadHandler>();
  private pendingChanges = new Map<string, PendingChange & { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(config: SelfImproveConfig, approvalHandler: ApprovalHandler) {
    this.projectRoot = path.resolve(config.projectRoot);
    this.allowedExtensions = new Set(
      config.allowedExtensions ?? DEFAULT_EXTENSIONS,
    );
    this.protectedPaths = new Set(
      config.protectedPaths ?? DEFAULT_PROTECTED,
    );
    this.approvalTimeoutMs = config.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT;
    this.approvalHandler = approvalHandler;
  }

  // ── Hot Reload Registration ──────────────────────────────────────

  /**
   * Register a hot-reload handler for a file path pattern.
   * After a matching file is written, the handler is called.
   *
   * @param pattern - Substring or suffix to match (e.g. "personality.ts")
   * @param handler - Async function to call after the file is written
   */
  registerHotReload(pattern: string, handler: HotReloadHandler): void {
    this.hotReloadHandlers.set(pattern, handler);
  }

  // ── Path Validation ──────────────────────────────────────────────

  /**
   * Validate that a file path is within the project and is allowed.
   * Public so consumers can pre-check paths.
   */
  validatePath(filePath: string): { valid: boolean; resolved: string; error?: string } {
    const resolved = path.resolve(this.projectRoot, filePath);

    // Must be within project root
    if (!resolved.startsWith(this.projectRoot)) {
      return { valid: false, resolved, error: 'Path escapes project root' };
    }

    // Check protected paths
    const relative = path.relative(this.projectRoot, resolved);
    const parts = relative.split(path.sep);
    for (const part of parts) {
      if (this.protectedPaths.has(part)) {
        return { valid: false, resolved, error: `Protected path: ${part}` };
      }
    }

    // Check extension (directories don't have extensions — allow them)
    const ext = path.extname(resolved).toLowerCase();
    if (ext && !this.allowedExtensions.has(ext)) {
      return { valid: false, resolved, error: `Disallowed extension: ${ext}` };
    }

    return { valid: true, resolved };
  }

  // ── Read Operations (no approval needed) ─────────────────────────

  /**
   * Read a project file. Safe — no approval required.
   */
  async readFile(filePath: string): Promise<string> {
    const { valid, resolved, error } = this.validatePath(filePath);
    if (!valid) throw new Error(error);
    return fs.readFile(resolved, 'utf-8');
  }

  /**
   * List files in a project directory.
   */
  async listFiles(dirPath: string): Promise<string[]> {
    const { valid, resolved, error } = this.validatePath(dirPath || '.');
    if (!valid) throw new Error(error);

    const entries = await fs.readdir(resolved, { withFileTypes: true });
    return entries.map((e) => {
      const prefix = e.isDirectory() ? '[DIR] ' : '[FILE] ';
      return prefix + e.name;
    });
  }

  // ── Diff Generation ──────────────────────────────────────────────

  /**
   * Generate a simple unified diff between old and new content.
   */
  generateDiff(original: string, modified: string, filePath: string): string {
    const oldLines = original.split('\n');
    const newLines = modified.split('\n');
    const diffLines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

    const maxLen = Math.max(oldLines.length, newLines.length);
    let inHunk = false;
    let hunkStart = -1;
    const hunkLines: string[] = [];

    for (let i = 0; i < maxLen; i++) {
      const oldLine = i < oldLines.length ? oldLines[i] : undefined;
      const newLine = i < newLines.length ? newLines[i] : undefined;

      if (oldLine !== newLine) {
        if (!inHunk) {
          inHunk = true;
          hunkStart = Math.max(0, i - 2);
          for (let j = hunkStart; j < i; j++) {
            if (j < oldLines.length) hunkLines.push(` ${oldLines[j]}`);
          }
        }
        if (oldLine !== undefined && (newLine === undefined || oldLine !== newLine)) {
          hunkLines.push(`-${oldLine}`);
        }
        if (newLine !== undefined && (oldLine === undefined || oldLine !== newLine)) {
          hunkLines.push(`+${newLine}`);
        }
      } else if (inHunk) {
        hunkLines.push(` ${oldLine}`);
        if (hunkLines.filter((l) => l.startsWith('+') || l.startsWith('-')).length > 0) {
          const afterContext = hunkLines.slice(-3).every((l) => l.startsWith(' '));
          if (afterContext) {
            diffLines.push(`@@ -${hunkStart + 1} @@`);
            diffLines.push(...hunkLines);
            hunkLines.length = 0;
            inHunk = false;
          }
        }
      }
    }

    if (hunkLines.length > 0) {
      diffLines.push(`@@ -${hunkStart + 1} @@`);
      diffLines.push(...hunkLines);
    }

    return diffLines.join('\n');
  }

  // ── Propose & Apply Changes ──────────────────────────────────────

  /**
   * Propose a code change. The approval handler is called with the
   * diff and description. If approved, the file is written.
   *
   * Returns a ChangeResult indicating whether the change was applied.
   */
  async proposeChange(
    filePath: string,
    newContent: string,
    description: string,
  ): Promise<ChangeResult> {
    const { valid, resolved, error } = this.validatePath(filePath);
    if (!valid) return { approved: false, message: `Invalid path: ${error}` };

    // Read original content
    let originalContent = '';
    try {
      originalContent = await fs.readFile(resolved, 'utf-8');
    } catch {
      // New file — that's fine
    }

    const diff = this.generateDiff(originalContent, newContent, filePath);
    const id = crypto.randomUUID();

    const proposal: ChangeProposal = { id, filePath, description, diff };

    // Approval with timeout
    let approved: boolean;
    try {
      approved = await Promise.race([
        this.approvalHandler(proposal),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), this.approvalTimeoutMs),
        ),
      ]);
    } catch {
      return { approved: false, message: 'Change request timed out' };
    }

    if (!approved) {
      return { approved: false, message: 'Change denied by user' };
    }

    // Write the change
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, newContent, 'utf-8');
    } catch (err) {
      return { approved: false, message: `Failed to write: ${String(err)}` };
    }

    // Hot-reload if a handler is registered
    const relative = path.relative(this.projectRoot, resolved);
    for (const [pattern, handler] of this.hotReloadHandlers.entries()) {
      if (relative.includes(pattern) || relative.endsWith(pattern)) {
        try {
          await handler();
        } catch (reloadErr) {
          console.warn(`[SelfImprove] Hot-reload failed for ${pattern}:`, reloadErr);
        }
        break;
      }
    }

    return { approved: true, message: 'Change approved and applied' };
  }

  // ── Module Cache Invalidation ────────────────────────────────────

  /**
   * Invalidate Node's require cache for a given file path.
   * Useful after writing a change to force re-import.
   */
  invalidateModuleCache(filePath: string): void {
    const resolved = path.resolve(this.projectRoot, filePath);
    delete require.cache[resolved];
    for (const ext of ['.js', '.ts']) {
      delete require.cache[resolved + ext];
      delete require.cache[resolved.replace(/\.[jt]sx?$/, ext)];
    }
  }
}

// ── Tool Declarations ────────────────────────────────────────────────

/**
 * LLM tool declarations for self-modification capabilities.
 *
 * These are framework-agnostic function schemas that can be passed to
 * any LLM that supports tool/function calling (OpenAI, Gemini, Claude, etc.).
 *
 * @param agentName - Name of the agent (used in descriptions)
 * @returns Array of tool declarations
 */
export function getSelfImproveTools(agentName = 'the agent'): ToolDeclaration[] {
  return [
    {
      name: 'read_own_source',
      description:
        `Read one of ${agentName}'s own source code files. Use this to understand the current implementation before proposing changes. Path is relative to the project root.`,
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Relative path to the file within the project.',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'list_own_files',
      description:
        `List files in a directory of ${agentName}'s own source code. Path is relative to the project root.`,
      parameters: {
        type: 'object',
        properties: {
          dir_path: {
            type: 'string',
            description: 'Relative directory path within the project.',
          },
        },
        required: ['dir_path'],
      },
    },
    {
      name: 'propose_code_change',
      description:
        `Propose a change to ${agentName}'s own source code. The user will see a diff and must approve before the change is applied. Always read the file first with read_own_source, make targeted changes, and explain clearly what you are changing and why.`,
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Relative path to the file to modify.',
          },
          new_content: {
            type: 'string',
            description: 'The complete new content for the file.',
          },
          description: {
            type: 'string',
            description: 'Clear description of what is being changed and why. This is shown to the user for approval.',
          },
        },
        required: ['file_path', 'new_content', 'description'],
      },
    },
  ];
}
