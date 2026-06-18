import { describe, expect, it, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Module URLs for mocking – must be resolved BEFORE any import of the SUT
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
const cleanupServiceUrl = new URL(
  "../src/services/cleanup-service.js",
  import.meta.url,
).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;

// ---------------------------------------------------------------------------
// Shared mutable mock state — tests rewrite these in beforeEach or inline to
// control what the module-level mock closures return.
// ---------------------------------------------------------------------------

/**
 * Shards returned for user scope — separate from project to avoid double-counting.
 */
let mockUserShards: any[] = [];

/**
 * Shards returned for project scope.
 */
let mockProjectShards: any[] = [];

/**
 * Memories returned by vectorSearch.getAllMemories().
 */
let mockMemories: any[] = [];
let mockDbRunResult: { changes: number } = { changes: 1 };
let mockDbGetResult: any = null;
let mockCleanupShouldRun = false;
let mockCleanupDeleted = 0;

// ---------------------------------------------------------------------------
// Module-level mocks – arrow closures capture the *variable* not its value,
// so beforeEach reassignments are picked up at call time.
// ---------------------------------------------------------------------------
mock.module(shardManagerUrl, () => ({
  shardManager: {
    getAllShards: (scope: string) =>
      scope === "user" ? mockUserShards : mockProjectShards,
    decrementVectorCount: () => {},
  },
}));

mock.module(connectionManagerUrl, () => ({
  connectionManager: {
    getConnection: () => ({
      prepare: (_sql: string) => ({
        run: (..._args: any[]) => mockDbRunResult,
        get: () => mockDbGetResult,
        all: () => mockMemories,
      }),
    }),
  },
}));

mock.module(vectorSearchUrl, () => ({
  vectorSearch: {
    getAllMemories: () => mockMemories,
  },
}));

mock.module(cleanupServiceUrl, () => ({
  cleanupService: {
    shouldRunCleanup: async () => mockCleanupShouldRun,
    runCleanup: async () => ({
      deletedCount: mockCleanupDeleted,
      userCount: 0,
      projectCount: 0,
      promptsDeleted: 0,
      linkedMemoriesDeleted: 0,
      pinnedMemoriesSkipped: 0,
    }),
  },
}));

/**
 * Mutable config object — tests can edit properties before dynamic import().
 * Reset in beforeEach() so changes don't leak across tests.
 */
const mockConfigData: Record<string, any> = {
  deduplicationEnabled: true,
  autoCleanupEnabled: true,
  autoCleanupRetentionDays: 30,
  consolidation: {
    enabled: true,
    mergeThreshold: 0.92,
    minIntervalMs: 3_600_000,
  },
};

mock.module(configUrl, () => ({
  CONFIG: mockConfigData,
  initConfig: () => {},
  isConfigured: () => true,
}));

mock.module(loggerUrl, () => ({
  log: () => {},
  logDebug: () => {},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an in-memory memory row matching vectorSearch.getAllMemories rows.
 */
function makeMemory(
  id: string,
  content: string,
  containerTag: string,
  createdAt: number,
  vector: number[],
): any {
  return {
    id,
    content,
    container_tag: containerTag,
    created_at: createdAt,
    updated_at: createdAt,
    vector: new Uint8Array(new Float32Array(vector).buffer),
    is_pinned: 0,
  };
}

// ---------------------------------------------------------------------------
// Reset all mutable mock state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockUserShards = [];
  mockProjectShards = [];
  mockMemories = [];
  mockDbRunResult = { changes: 1 };
  mockDbGetResult = null;
  mockCleanupShouldRun = false;
  mockCleanupDeleted = 0;
  // Reset mutable config to defaults
  mockConfigData.deduplicationEnabled = true;
  mockConfigData.autoCleanupEnabled = true;
  mockConfigData.autoCleanupRetentionDays = 30;
  mockConfigData.consolidation = {
    enabled: true,
    mergeThreshold: 0.92,
    minIntervalMs: 3_600_000,
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConsolidationService", () => {
  describe("shouldRun", () => {
    it("returns true when never run and not busy", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      const result = await svc.shouldRun();

      expect(result).toBe(true);
    });

    it("returns false when currently running", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();
      (svc as any).isRunning = true;

      const result = await svc.shouldRun();

      expect(result).toBe(false);
    });

    it("returns false when run recently (within minInterval)", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();
      (svc as any).lastRunTime = Date.now();

      const result = await svc.shouldRun();

      expect(result).toBe(false);
    });

    it("returns true after sufficient interval has elapsed", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();
      (svc as any).lastRunTime = Date.now() - 2 * 3600 * 1000; // 2 hours ago

      const result = await svc.shouldRun();

      expect(result).toBe(true);
    });

    it("returns false when consolidation is disabled in config", async () => {
      mockConfigData.consolidation = { enabled: false, mergeThreshold: 0.92, minIntervalMs: 3_600_000 };

      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      const result = await svc.shouldRun();

      expect(result).toBe(false);
    });

    it("returns false when consolidation config is undefined (graceful degradation)", async () => {
      mockConfigData.consolidation = undefined as any;

      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      const result = await svc.shouldRun();

      expect(result).toBe(false);
    });
  });

  describe("cosineSimilarity", () => {
    it("returns 1.0 for identical vectors", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const fn = (ConsolidationService.prototype as any).cosineSimilarity;
      const svc = new ConsolidationService();

      const a = new Float32Array([1, 2, 3, 4, 5]);
      const b = new Float32Array([1, 2, 3, 4, 5]);

      const result = fn.call(svc, a, b);

      expect(result).toBe(1.0);
    });

    it("returns ~1.0 for nearly identical vectors", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const fn = (ConsolidationService.prototype as any).cosineSimilarity;
      const svc = new ConsolidationService();

      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1.01, 2.01, 3.01]);

      const result = fn.call(svc, a, b);

      expect(result).toBeGreaterThan(0.999);
    });

    it("returns 0 for orthogonal vectors", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const fn = (ConsolidationService.prototype as any).cosineSimilarity;
      const svc = new ConsolidationService();

      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);

      const result = fn.call(svc, a, b);

      expect(result).toBe(0);
    });

    it("returns 0 for vectors of different lengths", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const fn = (ConsolidationService.prototype as any).cosineSimilarity;
      const svc = new ConsolidationService();

      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2, 3, 4]);

      const result = fn.call(svc, a, b);

      expect(result).toBe(0);
    });

    it("returns 0 when one vector is all zeros", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const fn = (ConsolidationService.prototype as any).cosineSimilarity;
      const svc = new ConsolidationService();

      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([1, 2, 3]);

      const result = fn.call(svc, a, b);

      expect(result).toBe(0);
    });
  });

  describe("Phase 2 - Merge", () => {
    it("merges near-duplicate memories with high similarity", async () => {
      mockUserShards = [
        {
          dbPath: "/tmp/test.db",
          id: "shard_1",
          container: "test",
          vectorCount: 2,
        },
      ];
      mockMemories = [
        makeMemory(
          "mem_older",
          "Hello world",
          "opencode_project_abc",
          1000,
          [1, 2, 3, 4, 5],
        ),
        makeMemory(
          "mem_newer",
          "Hello world!",
          "opencode_project_abc",
          2000,
          [1.001, 2.001, 3.001, 4.001, 5.001],
        ),
      ];
      // Simulate successful UPDATE
      mockDbRunResult = { changes: 1 };
      mockDbGetResult = null;

      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      const result = await svc.run();

      // Phase 2 should find the near-duplicate pair
      expect(result.phase2Merged).toBe(1);
      expect(result.phase2Superseded).toBe(1);
      expect(result.phase3Survivors).toBe(1);
    });

    it("skips memories below similarity threshold", async () => {
      mockUserShards = [
        {
          dbPath: "/tmp/test.db",
          id: "shard_1",
          container: "test",
          vectorCount: 2,
        },
      ];
      // Use orthogonal vectors → similarity = 0, well below 0.92 threshold
      mockMemories = [
        makeMemory(
          "mem_a",
          "Different topic A",
          "opencode_project_abc",
          1000,
          [1, 0, 0, 0, 0],
        ),
        makeMemory(
          "mem_b",
          "Different topic B",
          "opencode_project_abc",
          2000,
          [0, 1, 0, 0, 0],
        ),
      ];

      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      const result = await svc.run();

      expect(result.phase2Merged).toBe(0);
      expect(result.phase2Superseded).toBe(0);
    });

    it("handles empty shards", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      const result = await svc.run();

      expect(result.phase2Merged).toBe(0);
      expect(result.phase2Superseded).toBe(0);
    });

    it("skips memories without vectors", async () => {
      mockUserShards = [
        {
          dbPath: "/tmp/test.db",
          id: "shard_1",
          container: "test",
          vectorCount: 2,
        },
      ];
      // Memories without .vector should be silently skipped
      mockMemories = [
        {
          id: "mem_no_vec_1",
          content: "No vector A",
          container_tag: "opencode_project_abc",
          created_at: 1000,
        },
        {
          id: "mem_no_vec_2",
          content: "No vector B",
          container_tag: "opencode_project_abc",
          created_at: 2000,
        },
      ];

      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      const result = await svc.run();

      expect(result.phase2Merged).toBe(0);
      expect(result.phase2Superseded).toBe(0);
    });

    it("groups by container_tag (cross-tag merge prevented)", async () => {
      mockUserShards = [
        {
          dbPath: "/tmp/test.db",
          id: "shard_1",
          container: "test",
          vectorCount: 2,
        },
      ];
      // Same content vectors but different container tags → should NOT merge
      mockMemories = [
        makeMemory(
          "mem_tag_a",
          "Same content here",
          "opencode_project_tag_a",
          1000,
          [1, 2, 3, 4, 5],
        ),
        makeMemory(
          "mem_tag_b",
          "Same content here",
          "opencode_project_tag_b",
          2000,
          [1, 2, 3, 4, 5],
        ),
      ];

      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      const result = await svc.run();

      expect(result.phase2Merged).toBe(0);
      expect(result.phase2Superseded).toBe(0);
    });

    it("filters by projectTag (only merges memories matching the tag)", async () => {
      mockProjectShards = [
        {
          dbPath: "/tmp/test.db",
          id: "shard_1",
          container: "test",
          vectorCount: 4,
        },
      ];
      // 2 memories with target tag, similar vectors → should merge
      // 2 memories with other tag, similar vectors → should NOT merge (different tag)
      mockMemories = [
        makeMemory(
          "mem_target_1",
          "Target content",
          "opencode_project_target",
          1000,
          [1, 2, 3, 4, 5],
        ),
        makeMemory(
          "mem_target_2",
          "Target content!",
          "opencode_project_target",
          2000,
          [1.001, 2.001, 3.001, 4.001, 5.001],
        ),
        makeMemory(
          "mem_other_1",
          "Other content",
          "opencode_project_other",
          3000,
          [1, 2, 3, 4, 5],
        ),
        makeMemory(
          "mem_other_2",
          "Other content!",
          "opencode_project_other",
          4000,
          [1.001, 2.001, 3.001, 4.001, 5.001],
        ),
      ];
      mockDbRunResult = { changes: 1 };
      mockDbGetResult = null;

      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      const result = await svc.run("opencode_project_target");

      // Only the target-tag pair should be merged (1 merge = 2 memories → 1 superseded)
      expect(result.phase2Merged).toBe(1);
      expect(result.phase2Superseded).toBe(1);
    });
  });

  describe("full run", () => {
    it("returns ConsolidationResult with correct shape", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      const result = await svc.run();

      // Verify the shape matches the ConsolidationResult interface
      expect(result).toHaveProperty("phase1Pruned");
      expect(result).toHaveProperty("phase2Merged");
      expect(result).toHaveProperty("phase2Superseded");
      expect(result).toHaveProperty("phase3Survivors");
      expect(result).toHaveProperty("duration");
      expect(result).toHaveProperty("timestamp");

      expect(typeof result.phase1Pruned).toBe("number");
      expect(typeof result.phase2Merged).toBe("number");
      expect(typeof result.phase2Superseded).toBe("number");
      expect(typeof result.phase3Survivors).toBe("number");
      expect(typeof result.duration).toBe("number");
      expect(typeof result.timestamp).toBe("number");

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("handles errors gracefully (doesn't throw)", async () => {
      // Make the internal DB operations return 0 changes
      mockUserShards = [
        {
          dbPath: "/tmp/test.db",
          id: "shard_1",
          container: "test",
          vectorCount: 2,
        },
      ];
      mockMemories = [
        makeMemory(
          "mem_a",
          "Test content A",
          "opencode_project_abc",
          1000,
          [1, 2, 3, 4, 5],
        ),
        makeMemory(
          "mem_b",
          "Test content B",
          "opencode_project_abc",
          2000,
          [1.001, 2.001, 3.001, 4.001, 5.001],
        ),
      ];
      // Simulate DB failure on UPDATE operations
      mockDbRunResult = { changes: 0 };

      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();

      // Should NOT throw — all phase operations are wrapped in try/catch
      const result = await svc.run();

      // Should still return a well-formed result
      expect(result).toHaveProperty("phase1Pruned");
      expect(result).toHaveProperty("phase2Merged");
      expect(result).toHaveProperty("phase2Superseded");
      expect(result).toHaveProperty("phase3Survivors");
    });

    it("throws when already running", async () => {
      const { ConsolidationService } = await import(
        "../src/services/evolution/consolidation-service.js"
      );
      const svc = new ConsolidationService();
      (svc as any).isRunning = true;

      await expect(svc.run()).rejects.toThrow("Consolidation already running");
    });
  });
});
