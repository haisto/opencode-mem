import { userProfileManager } from "./user-profile-manager.js";
import type { UserProfileData } from "./types.js";
import { CONFIG } from "../../config.js";
import { embeddingService } from "../embedding.js";

/**
 * Minimal constraint for items that can be scored by embedding/filtering.
 */
interface ScoredItem {
  description: string;
  category?: string;
}

/**
 * Compute relevance score between a query and a target text.
 * Uses term overlap across all languages via Intl.Segmenter + CJK bigrams.
 */
function computeRelevance(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const terms = extractTerms(q);
  if (terms.length === 0) return 0;

  let matches = 0;
  for (const term of terms) {
    if (t.includes(term)) matches++;
  }

  return matches / terms.length;
}

/**
 * Extract indexable terms from text, supporting all languages.
 *
 * Strategy:
 * 1. Intl.Segmenter (word granularity) across the whole text — captures
 *    words/identifiers in any script (Latin, Arabic, Cyrillic, Devanagari, etc.)
 * 2. CJK bigram pass — adds adjacent pairs of CJK characters because word
 *    segmenters often under-split Chinese/Japanese/Korean text.
 * 3. All terms are lowercased, deduplicated, and must be >= 2 characters.
 */
function extractTerms(text: string): string[] {
  const terms = new Set<string>();

  // Step 1: Intl.Segmenter — works for all languages
  try {
    const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
    for (const seg of segmenter.segment(text)) {
      const word = seg.segment.toLowerCase();
      if (seg.isWordLike && word.length >= 2) {
        terms.add(word);
      }
    }
  } catch {
    // Intl.Segmenter not available (very old runtime), fallback to simple regex
    const words = text.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g);
    if (words) words.forEach((w) => terms.add(w));
  }

  // Step 2: CJK bigram — catches sub-word units in CJK text
  const cjkChars = [...text].filter((ch) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)
  );
  if (cjkChars.length > 1) {
    for (let i = 0; i < cjkChars.length - 1; i++) {
      const bigram = (cjkChars[i] as string + cjkChars[i + 1] as string).toLowerCase();
      terms.add(bigram);
    }
  }

  return Array.from(terms);
}

/**
 * Filter items by relevance to query.
 * Returns scored items sorted by relevance. When query is empty/undefined,
 * returns top items with score 0 (must be pre-sorted).
 */
function filterRelevant<T extends ScoredItem>(
  items: T[],
  query: string | undefined,
  maxItems: number,
  getText: (item: T) => string
): Array<{ item: T; score: number }> {
  if (!query || !query.trim()) {
    return items.slice(0, maxItems).map((item) => ({ item, score: 0 }));
  }

  const q = query.trim();
  const scored = items.map((item, index) => ({
    item,
    index,
    score: computeRelevance(q, getText(item)),
  }));

  const matched = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .slice(0, maxItems);

  // Fallback: no items matched the query, return default top maxItems
  if (matched.length === 0) {
    return items.slice(0, maxItems).map((item) => ({ item, score: 0 }));
  }

  return matched;
}

/**
 * Filter items by embedding similarity to the user message.
 * Returns scored items whose cosine similarity >= threshold, sorted by similarity.
 */
async function filterByEmbedding<T extends ScoredItem>(
  items: T[],
  query: string,
  threshold: number,
  getEmbeddingId: (item: T) => string | undefined,
): Promise<Array<{ item: T; score: number }>> {
  if (!query || items.length === 0) return [];

  const queryVec = await embeddingService.embedWithTimeout(query);
  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const id = getEmbeddingId(item);
    if (!id) continue;
    const storedVec = userProfileManager.getEmbeddingVector(id);
    if (!storedVec) continue;
    const score = userProfileManager.computeCosineSimilarity(
      Array.from(queryVec),
      Array.from(storedVec),
    );
    if (score >= threshold) {
      scored.push({ item, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Build profile context string for injection into the assistant's prompt.
 * Uses embedding-first semantic matching, falling back to CJK keyword matching.
 */
export async function getUserProfileContext(userId: string, userMessage?: string): Promise<string | null> {
  const profile = userProfileManager.getActiveProfile(userId);

  if (!profile) {
    return null;
  }

  const profileData: UserProfileData = JSON.parse(profile.profileData);
  const parts: string[] = [];

  const prefMax = CONFIG.chatMessage.injectMaxPreferences ?? 5;
  const patternMax = CONFIG.chatMessage.injectMaxPatterns ?? 5;
  const workflowMax = CONFIG.chatMessage.injectMaxWorkflows ?? 3;

  if (profileData.preferences.length > 0) {
    const items = [...profileData.preferences].sort((a, b) => b.confidence - a.confidence);
    const threshold = CONFIG.similarityThreshold ?? 0.6;
    let scored = userMessage
      ? await filterByEmbedding(items, userMessage, threshold, (p) => p.embeddingId)
      : [];
    if (scored.length < prefMax) {
      // Fallback: CJK keyword matching for items not already matched by embedding
      const fallback = filterRelevant(items, userMessage, prefMax, (p) => `${p.category} ${p.description}`);
      const existingKeys = new Set(scored.map((s) => `${s.item.category}|${s.item.description}`));
      for (const { item, score } of fallback) {
        const key = `${item.category}|${item.description}`;
        if (!existingKeys.has(key)) {
          scored.push({ item, score });
          existingKeys.add(key);
        }
      }
    }
    scored = scored.slice(0, prefMax);
    if (scored.length > 0) {
      parts.push("User Preferences:");
      scored.forEach(({ item, score }) => {
        const pct = score > 0 ? `[${Math.round(score * 100)}%] ` : "";
        parts.push(`- ${pct}[${item.category}] ${item.description}`);
      });
    }
  }

  if (profileData.patterns.length > 0) {
    const items = [...profileData.patterns].sort((a, b) => b.frequency - a.frequency);
    const threshold = CONFIG.similarityThreshold ?? 0.6;
    let scored = userMessage
      ? await filterByEmbedding(items, userMessage, threshold, (p) => p.embeddingId)
      : [];
    if (scored.length < patternMax) {
      const fallback = filterRelevant(items, userMessage, patternMax, (p) => `${p.category} ${p.description}`);
      const existingKeys = new Set(scored.map((s) => `${s.item.category}|${s.item.description}`));
      for (const { item, score } of fallback) {
        const key = `${item.category}|${item.description}`;
        if (!existingKeys.has(key)) {
          scored.push({ item, score });
          existingKeys.add(key);
        }
      }
    }
    scored = scored.slice(0, patternMax);
    if (scored.length > 0) {
      parts.push("\nUser Patterns:");
      scored.forEach(({ item, score }) => {
        const pct = score > 0 ? `[${Math.round(score * 100)}%] ` : "";
        parts.push(`- ${pct}[${item.category}] ${item.description}`);
      });
    }
  }

  if (profileData.workflows.length > 0) {
    const items = [...profileData.workflows].sort((a, b) => b.frequency - a.frequency);
    const threshold = CONFIG.similarityThreshold ?? 0.6;
    let scored = userMessage
      ? await filterByEmbedding(items, userMessage, threshold, (w) => w.embeddingId)
      : [];
    if (scored.length < workflowMax) {
      const fallback = filterRelevant(items, userMessage, workflowMax, (w) => w.description);
      const existingDescs = new Set(scored.map((s) => s.item.description));
      for (const { item, score } of fallback) {
        if (!existingDescs.has(item.description)) {
          scored.push({ item, score });
          existingDescs.add(item.description);
        }
      }
    }
    scored = scored.slice(0, workflowMax);
    if (scored.length > 0) {
      parts.push("\nUser Workflows:");
      scored.forEach(({ item, score }) => {
        const pct = score > 0 ? `[${Math.round(score * 100)}%] ` : "";
        parts.push(`- ${pct}${item.description}`);
      });
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n");
}
