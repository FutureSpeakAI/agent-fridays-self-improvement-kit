/**
 * self-improving-agent — Controlled self-modification for AI agents.
 *
 * Lets an AI agent read, diff, and propose changes to its own source
 * code — with mandatory human approval at every step.
 *
 * @module self-improving-agent
 * @see https://github.com/FutureSpeakAI/self-improving-agent
 */

export { SelfImproveEngine, getSelfImproveTools } from './self-improve';

export type {
  PendingChange,
  ChangeProposal,
  ChangeResult,
  ApprovalHandler,
  HotReloadHandler,
  SelfImproveConfig,
  ToolDeclaration,
} from './types';
