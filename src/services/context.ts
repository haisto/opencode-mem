import { CONFIG } from "../config.js";
import { getUserProfileContext } from "./user-profile/profile-context.js";
import { logDebug } from "./logger.js";

interface MemoryResultMinimal {
  similarity: number;
  memory?: string;
  chunk?: string;
}

interface MemoriesResponseMinimal {
  results?: MemoryResultMinimal[];
}

export function formatContextForPrompt(
  userId: string | null,
  projectMemories: MemoriesResponseMinimal,
  userMessage?: string
): string {
  const parts: string[] = ["[MEMORY]"];

  if (CONFIG.injectProfile && userId) {
    const profileContext = getUserProfileContext(userId, userMessage);
    if (profileContext) {
      parts.push("\n" + profileContext);
    }
  }

  const projectResults = projectMemories.results || [];
  if (projectResults.length > 0) {
    parts.push("\nProject Knowledge:");
    projectResults.forEach((mem) => {
      const similarity = Math.round(mem.similarity * 100);
      const content = mem.memory || mem.chunk || "";
      parts.push(`- [${similarity}%] ${content}`);
    });
  }

  if (parts.length === 1) {
    return "";
  }

  const result = parts.join("\n");
  logDebug("Injected context", {
    userId: userId ?? undefined,
    charCount: result.length,
    lineCount: result.split("\n").length,
    hasProfile: CONFIG.injectProfile && userId ? true : false,
    memoryCount: projectMemories.results?.length || 0,
    preview: result.slice(0, 300) + (result.length > 300 ? "..." : ""),
  });
  return result;
}
