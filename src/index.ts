import "reflect-metadata";
import { initializeDb } from "./db";
import { container } from "./container";
import { balanceRoutes } from "./routes/balance.route";
import { blocksRoutes } from "./routes/blocks.route";
import { rollbackRoutes } from "./routes/rollback.route";
import app from "./utils/fastify";
import { logger } from "./utils/logger";

async function bootstrap() {
  logger.info("Bootstrapping...");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  await initializeDb(databaseUrl);
  logger.info("Database initialized");

  // Container is initialized when imported, but ensure database is ready first
  // The container will use getDb() which requires database to be initialized
  logger.info("Container initialized");

  await app.register(blocksRoutes);
  await app.register(balanceRoutes);
  await app.register(rollbackRoutes);

  app.get("/", async (request, reply) => {
    return { status: "ok" };
  });
}

try {
  await bootstrap();
  await app.listen({
    port: 3000,
    host: "0.0.0.0",
  });
  logger.info("Server listening on port 3000");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
