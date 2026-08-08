import { Prisma } from "@prisma/client";
import { prisma } from "../client";
import type {
  IdempotencyRecord,
  IdempotencyRepository,
  StoredIdempotencyRecord,
} from "../../modules/idempotency/application/idempotency-repository";
import type { IdempotencyKey } from "../../validation/request/idempotency";

export class PrismaIdempotencyRepository implements IdempotencyRepository {
  async create(input: StoredIdempotencyRecord): Promise<IdempotencyRecord> {
    try {
      const row = await prisma.idempotencyRecord.create({
        data: {
          actor_key: input.actorKey,
          idempotency_key: input.idempotencyKey,
          endpoint: input.endpoint,
          request_hash: input.requestHash,
          response_status: input.responseStatus,
          response_body: input.responseBody as Prisma.InputJsonValue,
          expires_at: input.expiresAt,
        },
      });
      return toRecord(row);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
      const existing = await prisma.idempotencyRecord.findUnique({
        where: {
          actor_key_idempotency_key: {
            actor_key: input.actorKey,
            idempotency_key: input.idempotencyKey,
          },
        },
      });
      if (existing === null) {
        throw error;
      }
      return toRecord(existing);
    }
  }

  async get(
    actorKey: string,
    idempotencyKey: IdempotencyKey
  ): Promise<IdempotencyRecord | null> {
    const row = await prisma.idempotencyRecord.findUnique({
      where: {
        actor_key_idempotency_key: { actor_key: actorKey, idempotency_key: idempotencyKey },
      },
    });
    return row === null ? null : toRecord(row);
  }

  async update(
    actorKey: string,
    idempotencyKey: IdempotencyKey,
    responseStatus: number,
    responseBody: unknown
  ): Promise<IdempotencyRecord | null> {
    const row = await prisma.idempotencyRecord.update({
      where: {
        actor_key_idempotency_key: { actor_key: actorKey, idempotency_key: idempotencyKey },
      },
      data: {
        response_status: responseStatus,
        response_body: responseBody as Prisma.InputJsonValue,
      },
    });
    return toRecord(row);
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await prisma.idempotencyRecord.deleteMany({
      where: { expires_at: { lt: now } },
    });
    return result.count;
  }
}

function toRecord(row: {
  id: string;
  actor_key: string;
  idempotency_key: string;
  endpoint: string;
  request_hash: string | null;
  response_status: number;
  response_body: Prisma.JsonValue;
  created_at: Date;
  expires_at: Date;
}): IdempotencyRecord {
  return {
    id: row.id,
    actorKey: row.actor_key,
    idempotencyKey: row.idempotency_key as IdempotencyKey,
    endpoint: row.endpoint,
    requestHash: row.request_hash,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
