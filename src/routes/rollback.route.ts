import z from "zod";
import { container } from "../container";
import { getErrorStatusCode, NoBlocksToRollbackError } from "../errors";
import { MutexService } from "../services/mutex.service";
import { RollbackService } from "../services/rollback.service";
import { TYPES } from "../types/di.types";
import type { App } from "../utils/fastify";
import { logger } from "../utils/logger";

const DEFAULT_TIMEOUT_MS = 5000;

export async function rollbackRoutes(fastify: App) {
  fastify.route({
    method: "POST",
    url: "/rollback",
    schema: {
      querystring: z.object({
        height: z.string().transform((val) => {
          const parsed = parseInt(val, 10);
          if (isNaN(parsed)) {
            throw new Error("Height must be a valid number");
          }
          return parsed;
        }),
      }),
    },
    handler: async (request, reply) => {
      const { height } = request.query;
      const rollbackService = container.get<RollbackService>(
        TYPES.RollbackService
      );
      const mutexService = container.get<MutexService>(TYPES.MutexService);
      const requestId = request.id;

      const timeoutHeader = request.headers["x-block-ttl"];
      const timeoutMs =
        timeoutHeader && typeof timeoutHeader === "string"
          ? parseInt(timeoutHeader, 10)
          : DEFAULT_TIMEOUT_MS;

      if (isNaN(timeoutMs) || timeoutMs <= 0) {
        logger.warn(
          {
            requestId,
            method: request.method,
            url: request.url,
            timeoutHeader,
            timeoutMs,
          },
          "Invalid x-block-ttl header value"
        );
        return reply
          .status(400)
          .send({ error: "Invalid x-block-ttl header value" });
      }

      const mutexResult = await mutexService.acquireWithTimeout(timeoutMs);
      if (mutexResult.isErr()) {
        const error = mutexResult.error;
        const statusCode = getErrorStatusCode(error);

        logger.error(error, "Error acquiring mutex");

        return reply.status(statusCode).send({ error: error.message });
      }

      const release = mutexResult.value;

      try {
        const rollbackResult = await rollbackService.rollbackToHeight(height);

        if (rollbackResult.isErr()) {
          const error = rollbackResult.error;
          const statusCode = getErrorStatusCode(error);

          logger.error(error, "Error performing rollback");

          // Provide a more descriptive error message for rollback with no blocks to rollback
          if (error instanceof NoBlocksToRollbackError) {
            const errorMessage =
              error.currentHeight === 0
                ? `Cannot rollback to height ${error.targetHeight}: no blocks exist in the chain.`
                : `Cannot rollback to height ${error.targetHeight}: no blocks exist above this height. Current height is ${error.currentHeight}.`;

            return reply.status(statusCode).send({ error: errorMessage });
          }

          return reply.status(statusCode).send({ error: error.message });
        }

        return reply.status(200).send({ success: true });
      } finally {
        release();
      }
    },
  });
}
