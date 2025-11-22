import { container } from "../container";
import { getErrorStatusCode } from "../errors";
import { BlockService } from "../services/block.service";
import { MutexService } from "../services/mutex.service";
import { BlockSchema } from "../types/block.types";
import { TYPES } from "../types/di.types";
import type { App } from "../utils/fastify";
import { logger } from "../utils/logger";

const DEFAULT_TIMEOUT_MS = 5000;

export async function blocksRoutes(fastify: App) {
  fastify.route({
    method: "POST",
    url: "/blocks",
    schema: {
      body: BlockSchema,
    },
    handler: async (request, reply) => {
      const block = request.body;
      const blockService = container.get<BlockService>(TYPES.BlockService);
      const mutexService = container.get<MutexService>(TYPES.MutexService);
      const requestId = request.id;

      // Extract timeout from header or use default
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
        const processResult = await blockService.processBlock(block);

        if (processResult.isErr()) {
          const error = processResult.error;
          const statusCode = getErrorStatusCode(error);

          logger.error(error, "Error processing block");

          return reply.status(statusCode).send({ error: error.message });
        }

        return reply.status(200).send({ success: true });
      } finally {
        release();
      }
    },
  });
}
