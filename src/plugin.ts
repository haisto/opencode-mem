import type { Plugin, PluginInput, PluginModule } from "@opencode-ai/plugin";
import pkg from "../package.json" with { type: "json" };
const { OpenCodeMemPlugin: OriginalPlugin } = await import("./index.js");
const { runAllMigrations } = await import("./services/migrations/bootstrap.js");
const { log } = await import("./services/logger.js");

/**
 * Wraps the core plugin to run database schema migrations after
 * the plugin has been fully initialized (initConfig complete).
 */
const OpenCodeMemPlugin: Plugin = async (ctx: PluginInput) => {
  const result = await OriginalPlugin(ctx);
  // Fire-and-forget: migrations are idempotent and non-blocking
  runAllMigrations().catch((err) => {
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    log("Migration bootstrap error", { error: msg });
  });
  return result;
};

export const id =
  typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : "opencode-mem";
export { OpenCodeMemPlugin };
export default { id, server: OpenCodeMemPlugin } satisfies PluginModule;
