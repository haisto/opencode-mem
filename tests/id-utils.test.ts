import { describe, it, expect } from "bun:test";
import { isMemoryId, isPromptId, isId } from "../src/services/id-utils.js";

describe("isMemoryId", () => {
  it("should match standard memory ID format", () => {
    expect(isMemoryId("mem_1712345678000_abc123def")).toBe(true);
  });

  it("should match memory ID with leading zeros in timestamp", () => {
    expect(isMemoryId("mem_01712345678000_a1b2c3d4e")).toBe(true);
  });

  it("should reject uppercase characters", () => {
    expect(isMemoryId("mem_1712345678000_ABC123DEF")).toBe(false);
  });

  it("should reject non-alphanumeric random part", () => {
    expect(isMemoryId("mem_1712345678000_abc-234def")).toBe(false);
  });

  it("should reject wrong prefix", () => {
    expect(isMemoryId("prompt_1712345678000_abc123def")).toBe(false);
  });

  it("should reject wrong random part length", () => {
    expect(isMemoryId("mem_1712345678000_abc123defg")).toBe(false);
    expect(isMemoryId("mem_1712345678000_abc123de")).toBe(false);
  });

  it("should reject empty string", () => {
    expect(isMemoryId("")).toBe(false);
  });

  it("should reject string without prefix", () => {
    expect(isMemoryId("1712345678000_abc123def")).toBe(false);
  });

  it("should reject extra suffix", () => {
    expect(isMemoryId("mem_1712345678000_abc123def_extra")).toBe(false);
  });

  it("should reject random unrelated string", () => {
    expect(isMemoryId("如何使用React")).toBe(false);
  });
});

describe("isPromptId", () => {
  it("should match standard prompt ID format", () => {
    expect(isPromptId("prompt_1712345678000_abc123d")).toBe(true);
  });

  it("should reject wrong random part length", () => {
    expect(isPromptId("prompt_1712345678000_abc123de")).toBe(false);
    expect(isPromptId("prompt_1712345678000_abc123")).toBe(false);
  });

  it("should reject memory ID prefix", () => {
    expect(isPromptId("mem_1712345678000_abc123d")).toBe(false);
  });

  it("should reject empty string", () => {
    expect(isPromptId("")).toBe(false);
  });

  it("should reject uppercase", () => {
    expect(isPromptId("prompt_1712345678000_ABC123D")).toBe(false);
  });
});

describe("isId", () => {
  it("should return true for memory IDs", () => {
    expect(isId("mem_1712345678000_abc123def")).toBe(true);
  });

  it("should return true for prompt IDs", () => {
    expect(isId("prompt_1712345678000_abc123d")).toBe(true);
  });

  it("should return false for unrelated strings", () => {
    expect(isId("随便搜点什么")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isId("")).toBe(false);
  });
});
