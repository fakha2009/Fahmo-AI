import { prisma } from "../client";
import type {
  SessionRecord,
  SessionRepository,
} from "../../modules/identity/application/session-repository";

export class PrismaSessionRepository implements SessionRepository {
  async create(input: { id: string; tokenHash: string; expiresAt: Date }): Promise<SessionRecord> {
    const row = await prisma.anonymousSession.create({
      data: {
        id: input.id,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
      },
    });
    return toRecord(row);
  }

  async getByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await prisma.anonymousSession.findUnique({
      where: { token_hash: tokenHash },
    });
    return row === null ? null : toRecord(row);
  }

  async get(id: string): Promise<SessionRecord | null> {
    const row = await prisma.anonymousSession.findUnique({ where: { id } });
    return row === null ? null : toRecord(row);
  }

  async updateLastSeen(id: string, at: Date): Promise<void> {
    await prisma.anonymousSession.update({
      where: { id },
      data: { last_seen_at: at },
    });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await prisma.anonymousSession.update({
      where: { id },
      data: { revoked_at: at },
    });
  }
}

function toRecord(row: {
  id: string;
  token_hash: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}): SessionRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}
