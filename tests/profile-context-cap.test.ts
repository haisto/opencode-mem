/**
 * Tests for getUserProfileContext capping behavior.
 * Verifies that injectMaxPreferences (5), injectMaxPatterns (5),
 * and injectMaxWorkflows (3) are enforced regardless of embedding match count.
 *
 * Regression: filterByEmbedding returned unlimited items (all above threshold)
 * while slice(0, max) only ran inside `if (scored.length < max)` which was skipped.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ── Mock embedding (no conflict with other tests) ────────────────────
const embeddingUrl = new URL(
  "../src/services/embedding.js",
  import.meta.url,
).href;
mock.module(embeddingUrl, () => ({
  embeddingService: {
    embedWithTimeout: () => Promise.resolve(new Float32Array(768)),
  },
}));

// ── Mock user-profile-manager to avoid singleton init issues ─────────
const userProfileManagerUrl = new URL(
  "../src/services/user-profile/user-profile-manager.js",
  import.meta.url,
).href;
let mockActiveProfile: Record<string, unknown> | null = null;

mock.module(userProfileManagerUrl, () => ({
  userProfileManager: {
    getActiveProfile() {
      return mockActiveProfile;
    },
    getEmbeddingVector() {
      return new Float32Array(768).fill(0.01);
    },
    computeCosineSimilarity() {
      return 0.95; // All items pass the embedding threshold
    },
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────
function makePrefs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    category: "test-cat",
    description: `preference item ${i + 1}`,
    confidence: 0.9 - i * 0.05,
    evidence: ["test"],
    lastUpdated: Date.now(),
    embeddingId: `pref_emb_${i}`,
  }));
}

function makePatterns(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    category: "tech-interest",
    description: `pattern item ${i + 1}`,
    frequency: 10 - i,
    lastSeen: Date.now(),
    embeddingId: `pat_emb_${i}`,
  }));
}

function makeWorkflows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    description: `workflow item ${i + 1}`,
    steps: ["step a", "step b"],
    frequency: 10 - i,
    lastSeen: Date.now(),
    embeddingId: `wf_emb_${i}`,
  }));
}

function setMockProfile(
  prefs: number,
  patterns: number,
  workflows: number,
) {
  mockActiveProfile = {
    id: "profile_test",
    userId: "test@example.com",
    displayName: "Test",
    userName: "test",
    userEmail: "test@example.com",
    profileData: JSON.stringify({
      preferences: makePrefs(prefs),
      patterns: makePatterns(patterns),
      workflows: makeWorkflows(workflows),
    }),
    version: 1,
    createdAt: Date.now(),
    lastAnalyzedAt: Date.now(),
    totalPromptsAnalyzed: 5,
    isActive: true,
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("getUserProfileContext cap enforcement", () => {
  beforeEach(async () => {
    mockActiveProfile = null;

    // Ensure CONFIG has the needed chatMessage properties.
    // Other tests (e.g. config-resolution) may call initConfig() that
    // strips chatMessage from the singleton, making it undefined.
    const { CONFIG } = await import("../src/config.js");
    CONFIG.chatMessage = {
      ...CONFIG.chatMessage,
      injectMaxPreferences: 5,
      injectMaxPatterns: 5,
      injectMaxWorkflows: 3,
    };
    CONFIG.similarityThreshold = 0.6;
    CONFIG.injectProfile = true;
  });

  afterEach(() => {
    mockActiveProfile = null;
  });

  it("caps preferences at injectMaxPreferences when embedding returns more than limit", async () => {
    setMockProfile(10, 0, 0);

    const { getUserProfileContext } = await import(
      "../src/services/user-profile/profile-context.js"
    );
    const result = await getUserProfileContext("test@example.com", "test query");

    expect(result).not.toBeNull();
    const prefLines = result!.split("\n").filter((l) => l.startsWith("- "));
    expect(prefLines.length).toBe(5);
  });

  it("caps preferences at injectMaxPreferences when no embedding match, fallback fills", async () => {
    // No embeddingId → filterByEmbedding returns [], fallback takes top 5
    mockActiveProfile = {
      id: "profile_test",
      userId: "test@example.com",
      displayName: "Test",
      userName: "test",
      userEmail: "test@example.com",
      profileData: JSON.stringify({
        preferences: Array.from({ length: 10 }, (_, i) => ({
          category: "test-cat",
          description: `preference item ${i + 1}`,
          confidence: 0.9 - i * 0.05,
          evidence: ["test"],
          lastUpdated: Date.now(),
        })),
        patterns: [],
        workflows: [],
      }),
      version: 1,
      createdAt: Date.now(),
      lastAnalyzedAt: Date.now(),
      totalPromptsAnalyzed: 5,
      isActive: true,
    };

    const { getUserProfileContext } = await import(
      "../src/services/user-profile/profile-context.js"
    );
    const result = await getUserProfileContext("test@example.com", "test query");

    expect(result).not.toBeNull();
    const prefLines = result!.split("\n").filter((l) => l.startsWith("- "));
    expect(prefLines.length).toBe(5);
  });

  it("caps patterns at injectMaxPatterns when embedding returns more than limit", async () => {
    setMockProfile(0, 10, 0);

    const { getUserProfileContext } = await import(
      "../src/services/user-profile/profile-context.js"
    );
    const result = await getUserProfileContext("test@example.com", "test query");

    expect(result).not.toBeNull();
    const patternLines = result!.split("\n").filter((l) => l.startsWith("- "));
    expect(patternLines.length).toBe(5);
  });

  it("caps workflows at injectMaxWorkflows when embedding returns more than limit", async () => {
    setMockProfile(0, 0, 10);

    const { getUserProfileContext } = await import(
      "../src/services/user-profile/profile-context.js"
    );
    const result = await getUserProfileContext("test@example.com", "test query");

    expect(result).not.toBeNull();
    const wfLines = result!.split("\n").filter((l) => l.startsWith("- "));
    expect(wfLines.length).toBe(3);
  });

  it("caps each section independently when all exceed limits", async () => {
    setMockProfile(10, 10, 10);

    const { getUserProfileContext } = await import(
      "../src/services/user-profile/profile-context.js"
    );
    const result = await getUserProfileContext("test@example.com", "test query");

    expect(result).not.toBeNull();
    const lines = result!.split("\n");
    expect(lines.filter((l) => l.startsWith("User Preferences")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("User Patterns")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("User Workflows")).length).toBe(1);
    // Total capped: 5 + 5 + 3 = 13
    expect(lines.filter((l) => l.startsWith("- ")).length).toBe(13);
  });

  it("returns null when profile has no items", async () => {
    setMockProfile(0, 0, 0);

    const { getUserProfileContext } = await import(
      "../src/services/user-profile/profile-context.js"
    );
    const result = await getUserProfileContext("test@example.com", "test query");
    expect(result).toBeNull();
  });

  it("returns top items by confidence when no userMessage provided", async () => {
    mockActiveProfile = {
      id: "profile_test",
      userId: "test@example.com",
      displayName: "Test",
      userName: "test",
      userEmail: "test@example.com",
      profileData: JSON.stringify({
        preferences: Array.from({ length: 10 }, (_, i) => ({
          category: "test-cat",
          description: `preference item ${i + 1}`,
          confidence: 0.9 - i * 0.05,
          evidence: ["test"],
          lastUpdated: Date.now(),
          embeddingId: `pref_${i}`,
        })),
        patterns: [],
        workflows: [],
      }),
      version: 1,
      createdAt: Date.now(),
      lastAnalyzedAt: Date.now(),
      totalPromptsAnalyzed: 5,
      isActive: true,
    };

    const { getUserProfileContext } = await import(
      "../src/services/user-profile/profile-context.js"
    );
    const result = await getUserProfileContext("test@example.com", undefined);

    expect(result).not.toBeNull();
    const prefLines = result!.split("\n").filter((l) => l.startsWith("- "));
    expect(prefLines.length).toBe(5);
  });
});
