import { describe, expect, it, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Module URLs for mocking
// ---------------------------------------------------------------------------
const shardManagerUrl = new URL(
  "../src/services/sqlite/shard-manager.js",
  import.meta.url,
).href;
const connectionManagerUrl = new URL(
  "../src/services/sqlite/connection-manager.js",
  import.meta.url,
).href;
const vectorSearchUrl = new URL(
  "../src/services/sqlite/vector-search.js",
  import.meta.url,
).href;

const userPromptManagerUrl = new URL(
  "../src/services/user-prompt/user-prompt-manager.js",
  import.meta.url,
).href;

const apiHandlersUrl = new URL(
  "../src/services/api-handlers.js",
  import.meta.url,
).href;

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------
let mockShards: any[] = [];
let mockMemories: any[] = [];
let mockDb: any;

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
mock.module(shardManagerUrl, () => ({
  shardManager: {
    getAllShards: () => mockShards,
  },
}));

mock.module(connectionManagerUrl, () => ({
  connectionManager: {
    getConnection: () => mockDb,
  },
}));

mock.module(vectorSearchUrl, () => ({
  vectorSearch: {
    getAllMemories: () => mockMemories,
    listMemories: () => mockMemories,
  },
}));

/** user-prompt-manager is imported by api-handlers, needs a stub. */
mock.module(userPromptManagerUrl, () => ({
  userPromptManager: {
    getCapturedPrompts: () => [],
    searchPrompts: () => [],
    getPromptsByIds: () => [],
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Create a mock memory row like what better-sqlite3 returns from SELECT *.
 */
function makeMemory(overrides: Record<string, any> = {}) {
  return {
    id: "mem_test_123",
    content: "test memory content",
    type: "preference",
    tags: "test,memory",
    created_at: Date.now(),
    updated_at: null,
    container_tag: "opencode_project_test",
    metadata: null,
    display_name: null,
    user_name: null,
    user_email: null,
    project_path: null,
    project_name: null,
    git_repo_url: null,
    is_pinned: 0,
    superseded_by: null,
    merged_from: null,
    merge_count: 0,
    ...overrides,
  };
}

describe("handleListMemories mergeCount", () => {
  beforeEach(() => {
    mockShards = [{ id: 1, scope: "project", scopeHash: "test", shardIndex: 0, dbPath: ":memory:", vectorCount: 0, isActive: true, createdAt: Date.now() }];
    mockDb = {
      prepare: () => ({
        run: () => ({ changes: 1 }),
        get: () => null,
        all: () => [],
      }),
    };
  });

  it("includes mergeCount=0 for non-merged memories", async () => {
    mockMemories = [makeMemory({ id: "mem_001", merge_count: 0 })];
    const { handleListMemories } = await import(apiHandlersUrl);
    const result = await handleListMemories();
    expect(result.success).toBe(true);
    expect(result.data!.items[0]).toHaveProperty("mergeCount", 0);
  });

  it("includes mergeCount=5 for a survivor memory", async () => {
    mockMemories = [makeMemory({ id: "mem_002", merge_count: 5 })];
    const { handleListMemories } = await import(apiHandlersUrl);
    const result = await handleListMemories();
    expect(result.success).toBe(true);
    expect(result.data!.items[0]).toHaveProperty("mergeCount", 5);
  });

  it("includes mergeCount for every item in multi-item response", async () => {
    mockMemories = [
      makeMemory({ id: "mem_003", merge_count: 0 }),
      makeMemory({ id: "mem_004", merge_count: 3 }),
      makeMemory({ id: "mem_005", merge_count: 0 }),
      makeMemory({ id: "mem_006", merge_count: 1 }),
    ];
    const { handleListMemories } = await import(apiHandlersUrl);
    const result = await handleListMemories();
    expect(result.success).toBe(true);
    for (const item of result.data!.items) {
      expect(item).toHaveProperty("mergeCount");
    }
    const survivor = result.data!.items.find((i: any) => i.id === "mem_004");
    expect(survivor).toBeDefined();
    expect(survivor!.mergeCount).toBe(3);
  });
});
