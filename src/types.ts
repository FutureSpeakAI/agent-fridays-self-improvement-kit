/**
 * self-improving-agent — Type definitions
 *
 * @module self-improving-agent
 * @see https://github.com/FutureSpeakAI/self-improving-agent
 */

// ── Pending Change ────────────────────────────────────────────────────

export interface PendingChange {
  /** Unique identifier for this change proposal */
  id: string;

  /** Absolute resolved path to the file */
  filePath: string;

  /** Human-readable description of the change */
  description: string;

  /** Unified diff showing what will change */
  diff: string;

  /** The complete new content to write */
  newContent: string;

  /** The original content before modification */
  originalContent: string;
}

// ── Change Proposal (sent to the approval UI) ────────────────────────

export interface ChangeProposal {
  /** Unique identifier */
  id: string;

  /** Relative path within the project */
  filePath: string;

  /** Human-readable description */
  description: string;

  /** Unified diff */
  diff: string;
}

// ── Change Result ────────────────────────────────────────────────────

export interface ChangeResult {
  /** Whether the change was approved and applied */
  approved: boolean;

  /** Status message */
  message: string;
}

// ── Approval Handler ─────────────────────────────────────────────────

/**
 * You implement this to present change proposals to the user.
 *
 * The handler receives a ChangeProposal (containing the diff and
 * description) and must return a promise that resolves to `true`
 * (approved) or `false` (denied).
 *
 * Examples: GUI dialog, CLI prompt, Slack message + reaction, etc.
 */
export type ApprovalHandler = (proposal: ChangeProposal) => Promise<boolean>;

// ── Hot Reload Handler ───────────────────────────────────────────────

/**
 * Called after a file is written, keyed by a file-path pattern.
 * Use this to reload modules, rebuild, or notify watchers.
 */
export type HotReloadHandler = () => Promise<void>;

// ── Configuration ────────────────────────────────────────────────────

export interface SelfImproveConfig {
  /**
   * Root directory of the project the agent is allowed to read/modify.
   * All paths are resolved relative to this root.
   */
  projectRoot: string;

  /**
   * File extensions the agent is allowed to read and write.
   * Default: .ts, .tsx, .js, .jsx, .json, .css, .html, .md
   */
  allowedExtensions?: string[];

  /**
   * Directory/file names that should never be read or modified.
   * Default: node_modules, .git, dist, out, package-lock.json
   */
  protectedPaths?: string[];

  /**
   * How long to wait for user approval before timing out (ms).
   * Default: 60000 (60 seconds)
   */
  approvalTimeoutMs?: number;
}

// ── Tool Declarations ────────────────────────────────────────────────

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}
