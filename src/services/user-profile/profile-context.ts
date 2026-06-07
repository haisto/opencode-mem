import { userProfileManager } from "./user-profile-manager.js";
import type { UserProfileData } from "./types.js";
import { CONFIG } from "../../config.js";

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
 * When query is empty/undefined, returns top items (must be pre-sorted).
 */
function filterRelevant<T>(
  items: T[],
  query: string | undefined,
  maxItems: number,
  getText: (item: T) => string
): T[] {
  if (!query || !query.trim()) {
    return items.slice(0, maxItems);
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
      return a.index - b.index; // preserve original order
    })
    .slice(0, maxItems)
    .map(({ item }) => item);

  // Fallback: no items matched the query, return default top maxItems
  if (matched.length === 0) {
    return items.slice(0, maxItems);
  }

  return matched;
}

export function getUserProfileContext(userId: string, userMessage?: string): string | null {
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
    const relevant = filterRelevant(items, userMessage, prefMax, (p) => `${p.category} ${p.description}`);
    if (relevant.length > 0) {
      parts.push("User Preferences:");
      relevant.forEach((pref) => {
        parts.push(`- [${pref.category}] ${pref.description}`);
      });
    }
  }

  if (profileData.patterns.length > 0) {
    const items = [...profileData.patterns].sort((a, b) => b.frequency - a.frequency);
    const relevant = filterRelevant(items, userMessage, patternMax, (p) => `${p.category} ${p.description}`);
    if (relevant.length > 0) {
      parts.push("\nUser Patterns:");
      relevant.forEach((pattern) => {
        parts.push(`- [${pattern.category}] ${pattern.description}`);
      });
    }
  }

  if (profileData.workflows.length > 0) {
    const items = [...profileData.workflows].sort((a, b) => b.frequency - a.frequency);
    const relevant = filterRelevant(items, userMessage, workflowMax, (w) => w.description);
    if (relevant.length > 0) {
      parts.push("\nUser Workflows:");
      relevant.forEach((workflow) => {
        parts.push(`- ${workflow.description}`);
      });
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n");
}
