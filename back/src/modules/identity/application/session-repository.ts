export interface SessionRecord {
  id: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionRepository {
  create(input: { id: string; tokenHash: string; expiresAt: Date }): Promise<SessionRecord>;
  getByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  get(id: string): Promise<SessionRecord | null>;
  updateLastSeen(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
}
