import { getDatabase } from "../sqlite/sqlite-bootstrap.js";
import { join } from "node:path";
import { connectionManager } from "../sqlite/connection-manager.js";
import { CONFIG } from "../../config.js";
import type { UserProfile, UserProfileChangelog, UserProfileData } from "./types.js";
import { safeArray, safeObject } from "./profile-utils.js";
import { logDebug } from "../logger.js";
import type { ConfidenceStrategy } from "./confidence/confidence-strategy.js";
import { createConfidenceStrategy } from "./confidence/confidence-factory.js";
import { embeddingService } from "../embedding.js";

const Database = getDatabase();
type DatabaseType = typeof Database.prototype;

const USER_PROFILES_DB_NAME = "user-profiles.db";

export class UserProfileManager {
  private db: DatabaseType;
  private readonly dbPath: string;
  private readonly strategy: ConfidenceStrategy;

  constructor() {
    this.dbPath = join(CONFIG.storagePath, USER_PROFILES_DB_NAME);
    this.db = connectionManager.getConnection(this.dbPath);
    this.strategy = createConfidenceStrategy(
      CONFIG.userProfileConfidenceAlgorithm,
      CONFIG.userProfileConfidenceLearningRate
    );
    logDebug("Confidence strategy initialized", {
      algorithm: this.strategy.name,
      needsMatchCount: this.strategy.needsMatchCount,
      learningRate: CONFIG.userProfileConfidenceLearningRate,
    });
    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_email TEXT NOT NULL,
        profile_data TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_analyzed_at INTEGER NOT NULL,
        total_prompts_analyzed INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT 1
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_profile_changelogs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        change_type TEXT NOT NULL,
        change_summary TEXT NOT NULL,
        profile_data_snapshot TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
      )
    `);

    this.db.run("CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id)");
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active ON user_profiles(is_active)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_user_profile_changelogs_profile_id ON user_profile_changelogs(profile_id)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_user_profile_changelogs_version ON user_profile_changelogs(version DESC)"
    );

    // Fallback: migration may not have run yet when this constructor executes.
    // The v2 migration in USER_PROFILE_MIGRATIONS also creates this table.
    this.db.run(`
      CREATE TABLE IF NOT EXISTS profile_embeddings (
        id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  getActiveProfile(userId: string): UserProfile | null {
    const stmt = this.db.prepare(`
      SELECT * FROM user_profiles 
      WHERE user_id = ? AND is_active = 1
      LIMIT 1
    `);

    const row = stmt.get(userId) as any;
    if (!row) return null;

    return this.rowToProfile(row);
  }

  createProfile(
    userId: string,
    displayName: string,
    userName: string,
    userEmail: string,
    profileData: UserProfileData,
    promptsAnalyzed: number
  ): string {
    const id = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    const cleanedData: UserProfileData = {
      preferences: safeArray(profileData.preferences),
      patterns: safeArray(profileData.patterns),
      workflows: safeArray(profileData.workflows),
    };

    const stmt = this.db.prepare(`
      INSERT INTO user_profiles (
        id, user_id, display_name, user_name, user_email, 
        profile_data, version, created_at, last_analyzed_at, 
        total_prompts_analyzed, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1)
    `);

    stmt.run(
      id,
      userId,
      displayName,
      userName,
      userEmail,
      JSON.stringify(cleanedData),
      now,
      now,
      promptsAnalyzed
    );

    this.addChangelog(id, 1, "create", "Initial profile creation", cleanedData);

    return id;
  }

  updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string
  ): void {
    const now = Date.now();

    const cleanedData: UserProfileData = {
      preferences: safeArray(profileData.preferences),
      patterns: safeArray(profileData.patterns),
      workflows: safeArray(profileData.workflows),
    };

    const getVersionStmt = this.db.prepare(`SELECT version FROM user_profiles WHERE id = ?`);
    const versionRow = getVersionStmt.get(profileId) as any;
    const newVersion = (versionRow?.version || 0) + 1;

    const updateStmt = this.db.prepare(`
      UPDATE user_profiles 
      SET profile_data = ?, 
          version = ?, 
          last_analyzed_at = ?, 
          total_prompts_analyzed = total_prompts_analyzed + ?
      WHERE id = ?
    `);

    updateStmt.run(
      JSON.stringify(cleanedData),
      newVersion,
      now,
      additionalPromptsAnalyzed,
      profileId
    );

    // Reconcile: JSON is source of truth. Delete any embedding rows not
    // referenced by any active profile, so the table never accumulates orphans.
    const allProfiles = this.getAllActiveProfiles();
    const allReferencedIds = new Set<string>();
    for (const p of allProfiles) {
      const data: UserProfileData = JSON.parse(p.profileData);
      this.collectEmbeddingIds(data).forEach((id) => allReferencedIds.add(id));
    }
    const allEmbeddingRows = this.db.prepare(`SELECT id FROM profile_embeddings`).all() as any[];
    for (const row of allEmbeddingRows) {
      if (!allReferencedIds.has(row.id)) {
        this.db.prepare(`DELETE FROM profile_embeddings WHERE id = ?`).run(row.id);
      }
    }

    this.addChangelog(profileId, newVersion, "update", changeSummary, cleanedData);

    this.cleanupOldChangelogs(profileId);
  }

  /**
   * Delete specific preferences by their array indices.
   * Indices are sorted descending so splice doesn't shift unspliced indexes.
   */
  deletePreferences(profileId: string, indexes: number[]): void {
    const profile = this.getProfileById(profileId);
    if (!profile) throw new Error(`Profile not found: ${profileId}`);

    const data: UserProfileData = JSON.parse(profile.profileData);
    const sorted = [...indexes].sort((a, b) => b - a);

    for (const idx of sorted) {
      if (idx >= 0 && idx < data.preferences.length) {
        data.preferences.splice(idx, 1);
      }
    }

    this.updateProfile(profileId, data, 0, `Deleted ${indexes.length} preference(s)`);
  }

  deletePatterns(profileId: string, indexes: number[]): void {
    const profile = this.getProfileById(profileId);
    if (!profile) throw new Error(`Profile not found: ${profileId}`);

    const data: UserProfileData = JSON.parse(profile.profileData);
    const sorted = [...indexes].sort((a, b) => b - a);

    for (const idx of sorted) {
      if (idx >= 0 && idx < data.patterns.length) {
        data.patterns.splice(idx, 1);
      }
    }

    this.updateProfile(profileId, data, 0, `Deleted ${indexes.length} pattern(s)`);
  }

  deleteWorkflows(profileId: string, indexes: number[]): void {
    const profile = this.getProfileById(profileId);
    if (!profile) throw new Error(`Profile not found: ${profileId}`);

    const data: UserProfileData = JSON.parse(profile.profileData);
    const sorted = [...indexes].sort((a, b) => b - a);

    for (const idx of sorted) {
      if (idx >= 0 && idx < data.workflows.length) {
        data.workflows.splice(idx, 1);
      }
    }

    this.updateProfile(profileId, data, 0, `Deleted ${indexes.length} workflow(s)`);
  }

  private addChangelog(
    profileId: string,
    version: number,
    changeType: string,
    changeSummary: string,
    profileData: UserProfileData
  ): void {
    const id = `changelog_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO user_profile_changelogs (
        id, profile_id, version, change_type, change_summary, 
        profile_data_snapshot, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, profileId, version, changeType, changeSummary, JSON.stringify(profileData), now);
  }

  private cleanupOldChangelogs(profileId: string): void {
    const retentionCount = CONFIG.userProfileChangelogRetentionCount;

    const stmt = this.db.prepare(`
      DELETE FROM user_profile_changelogs 
      WHERE profile_id = ? 
      AND id NOT IN (
        SELECT id FROM user_profile_changelogs 
        WHERE profile_id = ? 
        ORDER BY version DESC 
        LIMIT ?
      )
    `);

    stmt.run(profileId, profileId, retentionCount);
  }

  /**
   * Embed text and store vector in profile_embeddings table.
   * Returns the generated embeddingId on success, or undefined if embedding fails
   * (the caller degrades gracefully).
   */
  private async embedDescription(text: string): Promise<string | undefined> {
    try {
      const vec = await embeddingService.embedWithTimeout(text);
      const id = `emb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      this.db
        .prepare(`INSERT INTO profile_embeddings (id, embedding, created_at) VALUES (?, ?, ?)`)
        .run(id, Buffer.from(vec.buffer), Date.now());
      return id;
    } catch {
      return undefined;
    }
  }

  /**
   * Retrieve embedding vector by its ID from profile_embeddings table.
   * Returns null if the ID no longer exists.
   */
  getEmbeddingVector(embeddingId: string): Float32Array | null {
    const row = this.db
      .prepare(`SELECT embedding FROM profile_embeddings WHERE id = ?`)
      .get(embeddingId) as any;
    if (!row || !row.embedding) return null;
    return new Float32Array(row.embedding.buffer);
  }

  /**
   * Collect all embeddingId values from preferences, patterns, and workflows.
   */
  private collectEmbeddingIds(data: UserProfileData): Set<string> {
    const ids = new Set<string>();
    for (const p of data.preferences) {
      if (p.embeddingId) ids.add(p.embeddingId);
    }
    for (const p of data.patterns) {
      if (p.embeddingId) ids.add(p.embeddingId);
    }
    for (const w of data.workflows) {
      if (w.embeddingId) ids.add(w.embeddingId);
    }
    return ids;
  }

  getProfileChangelogs(profileId: string, limit: number = 10): UserProfileChangelog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM user_profile_changelogs 
      WHERE profile_id = ? 
      ORDER BY version DESC 
      LIMIT ?
    `);

    const rows = stmt.all(profileId, limit) as any[];
    return rows.map((row) => this.rowToChangelog(row));
  }

  applyConfidenceDecay(profileId: string): void {
    const profile = this.getProfileById(profileId);
    if (!profile) return;

    const profileData: UserProfileData = JSON.parse(profile.profileData);
    const now = Date.now();
    const decayThreshold = CONFIG.userProfileConfidenceDecayDays * 24 * 60 * 60 * 1000;
    let hasChanges = false;
    const decayLogs: Array<{ action: string; [key: string]: unknown }> = [];

    profileData.preferences = profileData.preferences
      .map((pref) => {
        const age = now - pref.lastUpdated;
        const ageHours = Math.round((age / (1000 * 60 * 60)) * 10) / 10;
        if (age > decayThreshold) {
          hasChanges = true;
          const oldConfidence = pref.confidence;
          const newConfidence = this.strategy.decay({
            confidence: pref.confidence,
            age,
            decayThreshold,
            matchCount: pref.matchCount,
          });
          decayLogs.push({
            category: pref.category,
            description: pref.description,
            ageHours,
            decayThresholdDays: CONFIG.userProfileConfidenceDecayDays,
            oldConfidence: Math.round(oldConfidence * 100) / 100,
            newConfidence: Math.round(newConfidence * 100) / 100,
            action: "decayed",
          });
          return { ...pref, confidence: newConfidence, lastUpdated: now };
        }
        decayLogs.push({
          category: pref.category,
          description: pref.description,
          ageHours,
          decayThresholdDays: CONFIG.userProfileConfidenceDecayDays,
          confidence: Math.round(pref.confidence * 100) / 100,
          action: "skipped (not yet due)",
        });
        return pref;
      })
      .filter((pref) => {
        if (pref.confidence < 0.3) {
          decayLogs.push({
            category: pref.category,
            description: pref.description,
            confidence: Math.round(pref.confidence * 100) / 100,
            action: "removed (confidence < 0.3)",
          });
          return false;
        }
        return true;
      });

    if (decayLogs.length > 0) {
      logDebug("applyConfidenceDecay: preferences evaluated", {
        profileId,
        total: decayLogs.length,
        decayed: decayLogs.filter((l) => l.action === "decayed").length,
        removed: decayLogs.filter((l) => l.action?.includes("removed")).length,
        details: decayLogs,
      });
    }

    // Decay patterns by lastSeen + frequency (integer counter)
    profileData.patterns = profileData.patterns
      .map((pattern) => {
        const age = now - pattern.lastSeen;
        if (age > decayThreshold) {
          hasChanges = true;
          const decayFactor = Math.max(0.5, 1 - (age - decayThreshold) / decayThreshold);
          return { ...pattern, frequency: Math.floor(pattern.frequency * decayFactor), lastSeen: now };
        }
        return pattern;
      })
      .filter((pattern) => pattern.frequency >= 1);

    // Decay workflows by lastSeen + frequency (integer counter)
    profileData.workflows = profileData.workflows
      .map((workflow) => {
        const age = now - workflow.lastSeen;
        if (age > decayThreshold) {
          hasChanges = true;
          const decayFactor = Math.max(0.5, 1 - (age - decayThreshold) / decayThreshold);
          return { ...workflow, frequency: Math.floor(workflow.frequency * decayFactor), lastSeen: now };
        }
        return workflow;
      })
      .filter((workflow) => workflow.frequency >= 1);

    if (hasChanges) {
      this.updateProfile(profileId, profileData, 0, "Applied confidence decay to preferences");
    }
  }

  deleteProfile(profileId: string): void {
    const profile = this.getProfileById(profileId);
    if (!profile) return;

    const data: UserProfileData = JSON.parse(profile.profileData);
    const ids = this.collectEmbeddingIds(data);

    const deleteTx = this.db.transaction(() => {
      for (const id of ids) {
        this.db.prepare(`DELETE FROM profile_embeddings WHERE id = ?`).run(id);
      }
      this.db.prepare(`DELETE FROM user_profiles WHERE id = ?`).run(profileId);
    });

    deleteTx();
  }

  getProfileById(profileId: string): UserProfile | null {
    const stmt = this.db.prepare(`SELECT * FROM user_profiles WHERE id = ?`);
    const row = stmt.get(profileId) as any;
    if (!row) return null;
    return this.rowToProfile(row);
  }

  getAllActiveProfiles(): UserProfile[] {
    const stmt = this.db.prepare(`SELECT * FROM user_profiles WHERE is_active = 1`);
    const rows = stmt.all() as any[];
    return rows.map((row) => this.rowToProfile(row));
  }

  private rowToProfile(row: any): UserProfile {
    return {
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name,
      userName: row.user_name,
      userEmail: row.user_email,
      profileData: row.profile_data,
      version: row.version,
      createdAt: row.created_at,
      lastAnalyzedAt: row.last_analyzed_at,
      totalPromptsAnalyzed: row.total_prompts_analyzed,
      isActive: row.is_active === 1,
    };
  }

  private rowToChangelog(row: any): UserProfileChangelog {
    return {
      id: row.id,
      profileId: row.profile_id,
      version: row.version,
      changeType: row.change_type,
      changeSummary: row.change_summary,
      profileDataSnapshot: row.profile_data_snapshot,
      createdAt: row.created_at,
    };
  }

  /**
   * Compute cosine similarity between two vectors.
   * Returns a value in [0, 1] where 1 means identical direction.
   */
  computeCosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] || 0;
      const bVal = b[i] || 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Merge incoming profile data with existing profile.
   * Uses cosine similarity on description embeddings for semantic matching,
   * falling back to exact string match for legacy data without embeddings.
   */
  async mergeProfileData(
    existing: UserProfileData,
    updates: Partial<UserProfileData>,
  ): Promise<UserProfileData> {
    const merged: UserProfileData = {
      preferences: this.ensureArray(existing?.preferences),
      patterns: this.ensureArray(existing?.patterns),
      workflows: this.ensureArray(existing?.workflows),
    };

    // Local flag ensures warmup runs at most once per mergeProfileData call,
    // regardless of how many data sections need embedding.
    let warmedUp = false;
    const ensureWarmed = async () => {
      if (!warmedUp) { await embeddingService.warmup(); warmedUp = true; }
    };

    // Lazy backfill: embed existing items missing embeddingId so legacy data
    // gradually gains semantic matching capability on subsequent profile updates.
    const needsBackfill =
      merged.preferences.some((p) => !p.embeddingId) ||
      merged.patterns.some((p) => !p.embeddingId) ||
      merged.workflows.some((w) => !w.embeddingId);
    if (needsBackfill) await ensureWarmed();
    for (const pref of merged.preferences) {
      if (!pref.embeddingId && pref.description) {
        pref.embeddingId = await this.embedDescription(pref.description);
      }
    }
    for (const pat of merged.patterns) {
      if (!pat.embeddingId && pat.description) {
        pat.embeddingId = await this.embedDescription(pat.description);
      }
    }
    for (const wf of merged.workflows) {
      if (!wf.embeddingId && wf.description) {
        wf.embeddingId = await this.embedDescription(wf.description);
      }
    }

    if (updates.preferences) {
      const incomingPrefs = this.ensureArray(updates.preferences);

      // Warmup once before embedding batch
      const needsEmbed = incomingPrefs.some((p) => !p.embeddingId);
      if (needsEmbed) await ensureWarmed();

      // Embed incoming preferences that don't have an embeddingId yet
      for (const newPref of incomingPrefs) {
        if (!newPref.embeddingId && newPref.description) {
          newPref.embeddingId = await this.embedDescription(newPref.description);
        }
      }

      for (const newPref of incomingPrefs) {
        const existingIndex = merged.preferences.findIndex((p) => {
          if (p.embeddingId && newPref.embeddingId) {
            const a = this.getEmbeddingVector(p.embeddingId);
            const b = this.getEmbeddingVector(newPref.embeddingId);
            if (a && b) {
              if (this.computeCosineSimilarity(Array.from(a), Array.from(b)) > (CONFIG.userProfileMergeThreshold ?? 0.92)) {
                return true;
              }
            }
          }
          return p.category === newPref.category && p.description === newPref.description;
        });

        if (existingIndex >= 0) {
          const existingItem = merged.preferences[existingIndex];
          if (existingItem) {
            const matchCount = (existingItem.matchCount ?? 0) + 1;
            merged.preferences[existingIndex] = {
              ...newPref,
              confidence: this.strategy.merge({
                existingConfidence: existingItem.confidence,
                incomingConfidence: newPref.confidence ?? 0,
                existingEvidence: existingItem.evidence,
                incomingEvidence: newPref.evidence,
                matchCount,
              }),
              matchCount,
              evidence: [
                ...new Set([
                  ...this.ensureArray(existingItem.evidence),
                  ...this.ensureArray(newPref.evidence),
                ]),
              ].slice(0, 5),
              lastUpdated: Date.now(),
              embeddingId: newPref.embeddingId || existingItem.embeddingId,
            };
          }
        } else {
          merged.preferences.push({ ...newPref, lastUpdated: Date.now(), matchCount: 0 });
        }
      }

      merged.preferences.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      merged.preferences = merged.preferences.slice(0, CONFIG.userProfileMaxPreferences);
    }

    if (updates.patterns) {
      const incomingPatterns = this.ensureArray(updates.patterns);

      const needsEmbedPatterns = incomingPatterns.some((p) => !p.embeddingId);
      if (needsEmbedPatterns) await ensureWarmed();

      // Embed incoming patterns that don't have an embeddingId yet
      for (const newPattern of incomingPatterns) {
        if (!newPattern.embeddingId && newPattern.description) {
          newPattern.embeddingId = await this.embedDescription(newPattern.description);
        }
      }

      for (const newPattern of incomingPatterns) {
        const existingIndex = merged.patterns.findIndex((p) => {
          if (p.embeddingId && newPattern.embeddingId) {
            const a = this.getEmbeddingVector(p.embeddingId);
            const b = this.getEmbeddingVector(newPattern.embeddingId);
            if (a && b) {
              if (this.computeCosineSimilarity(Array.from(a), Array.from(b)) > (CONFIG.userProfileMergeThreshold ?? 0.92)) {
                return true;
              }
            }
          }
          return p.category === newPattern.category && p.description === newPattern.description;
        });

        if (existingIndex >= 0) {
          const existingItem = merged.patterns[existingIndex];
          if (existingItem) {
            const newFreq = (existingItem.frequency || 1) + 1;
            merged.patterns[existingIndex] = {
              ...newPattern,
              frequency: newFreq,
              lastSeen:
                newFreq > (existingItem.frequency || 1) * 1.5
                  ? Date.now()
                  : existingItem.lastSeen,
              embeddingId: newPattern.embeddingId || existingItem.embeddingId,
            };
          }
        } else {
          merged.patterns.push({ ...newPattern, frequency: 1, lastSeen: Date.now() });
        }
      }

      merged.patterns.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
      merged.patterns = merged.patterns.slice(0, CONFIG.userProfileMaxPatterns);
    }

    if (updates.workflows) {
      const incomingWorkflows = this.ensureArray(updates.workflows);

      // Warmup once before embedding batch
      const needsEmbedWorkflows = incomingWorkflows.some((w) => !w.embeddingId);
      if (needsEmbedWorkflows) await ensureWarmed();

      for (const newWorkflow of incomingWorkflows) {
        if (!newWorkflow.embeddingId && newWorkflow.description) {
          newWorkflow.embeddingId = await this.embedDescription(newWorkflow.description);
        }
      }

      for (const newWorkflow of incomingWorkflows) {
        const existingIndex = merged.workflows.findIndex((w) => {
          // Use cosine similarity for semantic matching when both sides have embeddings
          if (w.embeddingId && newWorkflow.embeddingId) {
            const a = this.getEmbeddingVector(w.embeddingId);
            const b = this.getEmbeddingVector(newWorkflow.embeddingId);
            if (a && b) {
              if (this.computeCosineSimilarity(Array.from(a), Array.from(b)) > (CONFIG.userProfileMergeThreshold ?? 0.92)) {
                return true;
              }
            }
          }
          // Fallback to exact string match for legacy data without embeddings
          return w.description === newWorkflow.description;
        });

        if (existingIndex >= 0) {
          const existingItem = merged.workflows[existingIndex];
          if (existingItem) {
            const newFreq = (existingItem.frequency || 1) + 1;
            merged.workflows[existingIndex] = {
              ...newWorkflow,
              frequency: newFreq,
              lastSeen:
                newFreq > (existingItem.frequency || 1) * 1.5
                  ? Date.now()
                  : existingItem.lastSeen,
              embeddingId: newWorkflow.embeddingId || existingItem.embeddingId,
            };
          }
        } else {
          merged.workflows.push({ ...newWorkflow, frequency: 1, lastSeen: Date.now() });
        }
      }

      merged.workflows.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
      merged.workflows = merged.workflows.slice(0, CONFIG.userProfileMaxWorkflows);
    }

    return merged;
  }

  private ensureArray(val: any): any[] {
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return Array.isArray(val) ? [...val] : [];
  }
}

export const userProfileManager = new UserProfileManager();
