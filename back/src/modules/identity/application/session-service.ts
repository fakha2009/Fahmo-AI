import { AppError } from "../../../shared/errors";
import { randomHex } from "../../../shared/utils/hash";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenFormat,
} from "../domain/session";
import type { SessionRecord, SessionRepository } from "./session-repository";

export interface IssuedSession {
  token: string;
  session: SessionRecord;
}

export interface SessionServiceOptions {
  ttlMs: number;
}

export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly options: SessionServiceOptions,
    private readonly now: () => Date = () => new Date()
  ) {}

  async create(): Promise<IssuedSession> {
    const token = generateSessionToken();
    const session = await this.repository.create({
      id: randomHex(16),
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(this.now().getTime() + this.options.ttlMs),
    });
    return { token, session };
  }

  async validate(token: string): Promise<SessionRecord> {
    if (!isSessionTokenFormat(token)) {
      throw new AppError({ code: "UNAUTHORIZED", message: "Невалидный токен сессии" });
    }
    const session = await this.repository.getByTokenHash(hashSessionToken(token));
    if (session === null) {
      throw new AppError({ code: "UNAUTHORIZED", message: "Сессия не найдена" });
    }
    if (session.revokedAt !== null) {
      throw new AppError({ code: "UNAUTHORIZED", message: "Сессия отозвана" });
    }
    if (session.expiresAt.getTime() <= this.now().getTime()) {
      throw new AppError({ code: "SESSION_EXPIRED" });
    }
    await this.repository.updateLastSeen(session.id, this.now());
    return session;
  }

  async rotate(token: string): Promise<IssuedSession> {
    const current = await this.validate(token);
    await this.repository.revoke(current.id, this.now());
    return this.create();
  }

  async revoke(token: string): Promise<void> {
    if (!isSessionTokenFormat(token)) {
      throw new AppError({ code: "UNAUTHORIZED", message: "Невалидный токен сессии" });
    }
    const session = await this.repository.getByTokenHash(hashSessionToken(token));
    if (session === null || session.revokedAt !== null) {
      return;
    }
    await this.repository.revoke(session.id, this.now());
  }
}
