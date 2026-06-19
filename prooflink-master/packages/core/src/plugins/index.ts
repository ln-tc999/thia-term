// ---------------------------------------------------------------------------
// Plugin System
// ---------------------------------------------------------------------------

import type { ComplianceDecision } from "@prooflink/shared";
import type { ComplianceRequest } from "../engine/prooflink.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context passed to plugin hooks. */
export interface PluginContext {
  /** The original compliance request */
  request: ComplianceRequest;
  /** Mutable metadata bag — plugins can attach data for downstream hooks */
  metadata: Record<string, unknown>;
}

/** Context passed to post-decision hooks. */
export interface PluginDecisionContext extends PluginContext {
  /** The compliance decision (mutable in afterDecision, read-only in beforeDecision) */
  decision: ComplianceDecision;
}

/**
 * ProofLink plugin interface.
 *
 * Plugins can hook into the compliance pipeline at four points:
 * - beforeCheck: Before any compliance checks run
 * - afterCheck: After all checks complete but before the decision is finalized
 * - beforeDecision: Before the decision is returned to the caller
 * - afterDecision: After the decision is returned (for side-effects like logging)
 *
 * All hooks are optional. Plugins should implement only the hooks they need.
 */
export interface ProofLinkPlugin {
  /** Unique plugin name */
  readonly name: string;
  /** Plugin version (semver) */
  readonly version: string;

  /** Called when the plugin is registered */
  onRegister?(): void | Promise<void>;
  /** Called when the plugin is unregistered */
  onDestroy?(): void | Promise<void>;

  /** Called before compliance checks begin. Can modify the request. */
  beforeCheck?(ctx: PluginContext): void | Promise<void>;
  /** Called after all compliance checks complete. */
  afterCheck?(ctx: PluginContext): void | Promise<void>;
  /** Called before the decision is finalized. Can modify the decision. */
  beforeDecision?(ctx: PluginDecisionContext): void | Promise<void>;
  /** Called after the decision is returned. For side-effects only. */
  afterDecision?(ctx: PluginDecisionContext): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// PluginManager
// ---------------------------------------------------------------------------

/**
 * Manages plugin registration and hook execution.
 *
 * Plugins are executed in registration order. If a plugin hook throws,
 * the error is propagated and subsequent plugins for that hook are skipped.
 */
export class PluginManager {
  private readonly plugins: ProofLinkPlugin[] = [];

  /**
   * Register a plugin. Calls onRegister if defined.
   * Throws if a plugin with the same name is already registered.
   */
  async registerPlugin(plugin: ProofLinkPlugin): Promise<void> {
    const existing = this.plugins.find((p) => p.name === plugin.name);
    if (existing) {
      throw new Error(
        `Plugin "${plugin.name}" is already registered (version ${existing.version})`,
      );
    }

    if (plugin.onRegister) {
      await plugin.onRegister();
    }

    this.plugins.push(plugin);
  }

  /**
   * Unregister a plugin by name. Calls onDestroy if defined.
   * Returns true if the plugin was found and removed.
   */
  async unregisterPlugin(name: string): Promise<boolean> {
    const idx = this.plugins.findIndex((p) => p.name === name);
    if (idx === -1) return false;

    const plugin = this.plugins[idx]!;
    if (plugin.onDestroy) {
      await plugin.onDestroy();
    }

    this.plugins.splice(idx, 1);
    return true;
  }

  /**
   * Get all registered plugins.
   */
  getPlugins(): ReadonlyArray<ProofLinkPlugin> {
    return this.plugins;
  }

  /**
   * Execute beforeCheck hooks on all registered plugins.
   */
  async executeBeforeCheck(ctx: PluginContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.beforeCheck) {
        await plugin.beforeCheck(ctx);
      }
    }
  }

  /**
   * Execute afterCheck hooks on all registered plugins.
   */
  async executeAfterCheck(ctx: PluginContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.afterCheck) {
        await plugin.afterCheck(ctx);
      }
    }
  }

  /**
   * Execute beforeDecision hooks on all registered plugins.
   */
  async executeBeforeDecision(ctx: PluginDecisionContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.beforeDecision) {
        await plugin.beforeDecision(ctx);
      }
    }
  }

  /**
   * Execute afterDecision hooks on all registered plugins.
   */
  async executeAfterDecision(ctx: PluginDecisionContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.afterDecision) {
        await plugin.afterDecision(ctx);
      }
    }
  }
}
