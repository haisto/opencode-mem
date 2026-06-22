# opencode-mem — Agent Guide

OpenCode plugin providing persistent memory with local vector database (SQLite + USearch/ExactScan) for AI coding agents.

## Repository Structure

```
src/
  plugin.ts        — Plugin entry: re-exports from index.ts
  index.ts         — Core plugin logic: tool definition, hooks, lifecycle
  config.ts        — Config: ~/.config/opencode/opencode-mem.jsonc, overridden by .opencode/opencode-mem.jsonc
  services/
    client.ts              — LocalMemoryClient: add/search/list/delete memories
    embedding.ts           — Lazy-loaded @xenova/transformers for local embeddings
    tags.ts                — Container tag derivation (user/project identity)
    privacy.ts             — <private>...</private> tag redaction
    logger.ts              — Logs to ~/.opencode-mem/opencode-mem.log (5MB auto-rotate)
    language-detector.ts   — franc-min + iso-639-3
    auto-capture.ts        — AI-driven memory extraction on session idle
    user-memory-learning.ts, user-profile/
    sqlite/                — Shard manager, connection manager, vector search
    vector-backends/       — USearch-first (preferred), ExactScan (fallback)
    web-server.ts          — Web UI on http://127.0.0.1:4747
tests/                     — bun:test, heavy use of mock.module() for DI
```

## Essential Commands

| Command | Purpose |
|---|---|
| `bun run build` | Compile TS + copy web assets to dist/ |
| `bun run typecheck` | `tsc --noEmit` (also runs in pre-commit) |
| `bun run dev` | `tsc --watch` |
| `bun run format` | Prettier write on src/ |
| `bun run format:check` | Prettier check |
| `bun test` | Run all tests (bun:test) |
| `bun test --file tests/some.test.ts` | Single test file |
| `bun install --ignore-scripts` | Install deps skipping sharp's native binary download (fix on Windows when sharp's libvips download fails) |

Pre-commit: `bun run typecheck && bunx lint-staged`.

Publishing: push `v*` tag → GitHub Actions runs install → typecheck → build → npm publish.

## Config

- **Global**: `~/.config/opencode/opencode-mem.jsonc`
- **Project override**: `<project>/.opencode/opencode-mem.jsonc` (deep-merges over global)
- Default embedding: `Xenova/nomic-embed-text-v1` (768d, local, multilingual)
- Default vector backend: `usearch-first` (tries USearch, falls back to ExactScan)
- Default scope: `project` (pass `all-projects` to cross-project search)
- AI auto-capture uses opencodeProvider (delegates to opencode's session API) OR manual `memoryApiKey`/`memoryApiUrl`/`memoryModel`

## Architecture Gotchas

1. **Warmup is fire-and-forget**: `memoryClient.warmup()` runs asynchronously in the background (not awaited) to avoid blocking opencode's plugin loader. The `memory` tool returns `"initializing"` if warmup is incomplete.
2. **Embedding model is lazy-loaded**: `@xenova/transformers` import path is obfuscated (`"@xenova".join("/") + "transformers"`) to prevent the plugin-loader bundler from traversing its internals at startup.
3. **Container tags**: Format is `{prefix}_{scope}_{hash}`, e.g. `opencode_project_abc123`. Scope is `user` or `project`. Memories are sharded by `(scope, hash)` pairs.
4. **Sharding**: After `maxVectorsPerShard` (default 50000) a new SQLite shard file is created automatically.
5. **Privacy**: Content wrapped in `<private>...</private>` is redacted to `[REDACTED]`. Memory `add` is rejected if all content is private.
6. **Chat message injection**: By default (`chatMessage.injectOn: "first"`), memories are only injected on the *first* user message of a session. Set to `"always"` to inject every turn.
7. **Compaction handler**: After a `session.compacted` event, the plugin re-injects memories belonging to that session as synthetic text parts.
8. **Idle processing**: `session.idle` triggers auto-capture + user profile learning + cleanup after a 10-second debounce.
9. **Logger**: `~/.opencode-mem/opencode-mem.log` — auto-rotates at 5 MB. Can be overridden via `OPENCODE_MEM_LOG_FILE` env var. **`logger.log()` is deprecated** — use `logInfo()`/`logWarn()`/`logError()`/`logDebug()`/`logTrace()` instead.
10. **Plugin warmup is tracked globally** (via `Symbol.for`): only runs once per process regardless of how many project directories share the same process.

## Testing

- Framework: **bun:test** (Bun native, no config file needed)
- Tests use `runScenario()` pattern: writes a script to temp dir, spawns a fresh `bun` process, captures JSON output
- Dependency injection: `mock.module()` to mock ES module imports (connection manager, embedding, shard manager, vector search)
- All tests import from `src/` (not `dist/`)
- Integration test for bundle boundary verifies the plugin bundle doesn't inline `@xenova/transformers`

## Code Style

- Prettier: semi, double quotes, 2-space indent, trailing commas (es5), printWidth 100, LF
- TypeScript: strict mode, `verbatimModuleSyntax`, no unused locals/params
- Plugin entry must satisfy `PluginModule` interface: `{ id, server: Plugin }`
- Tool definition uses `@opencode-ai/plugin`'s `tool()` builder with `tool.schema` for args
