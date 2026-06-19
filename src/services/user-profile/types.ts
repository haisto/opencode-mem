export interface UserProfilePreference {
  category: string;
  description: string;
  confidence: number;
  evidence: string[];
  lastUpdated: number;
  matchCount?: number;
  /**
   * Reference to the embedding vector stored in profile_embeddings table.
   * Used for semantic matching during merge; legacy data may lack this field.
   */
  embeddingId?: string;
}

export interface UserProfilePattern {
  category: string;
  description: string;
  frequency: number;
  lastSeen: number;
  /**
   * Reference to the embedding vector stored in profile_embeddings table.
   * Used for semantic matching during merge; legacy data may lack this field.
   */
  embeddingId?: string;
}

export interface UserProfileWorkflow {
  description: string;
  steps: string[];
  frequency: number;
  lastSeen: number;
  /**
   * Reference to the embedding vector stored in profile_embeddings table.
   * Used for semantic matching during merge; legacy data may lack this field.
   */
  embeddingId?: string;
}

export interface UserProfileData {
  preferences: UserProfilePreference[];
  patterns: UserProfilePattern[];
  workflows: UserProfileWorkflow[];
}

export interface UserProfile {
  id: string;
  userId: string;
  displayName: string;
  userName: string;
  userEmail: string;
  profileData: string;
  version: number;
  createdAt: number;
  lastAnalyzedAt: number;
  totalPromptsAnalyzed: number;
  isActive: boolean;
}

export interface UserProfileChangelog {
  id: string;
  profileId: string;
  version: number;
  changeType: string;
  changeSummary: string;
  profileDataSnapshot: string;
  createdAt: number;
}
