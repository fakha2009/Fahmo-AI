import "dotenv/config";
import { prisma } from "../src/database/client";

async function main() {
  const session = await prisma.anonymousSession.create({
    data: {
      token_hash: "smoke-test-hash",
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24),
    },
  });
  console.log("session created:", session.id);

  await prisma.analysis.create({
    data: {
      session_id: session.id,
      source_type: "TEXT",
      document_type: "ANNOUNCEMENT",
      output_language: "RU",
      detected_languages: ["ru"],
      status: "COMPLETED",
      structured_result: { title: "Тест", summary: "smoke" },
    },
  });

  const before = await prisma.analysis.count({ where: { session_id: session.id } });
  console.log("analyses before cascade:", before);

  await prisma.anonymousSession.delete({ where: { id: session.id } });

  const after = await prisma.analysis.count({ where: { session_id: session.id } });
  console.log("analyses after cascade:", after);

  if (before !== 1 || after !== 0) throw new Error("cascade broken");
  console.log("SMOKE TEST OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
