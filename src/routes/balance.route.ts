import z from "zod";
import { container } from "../container";
import { getErrorStatusCode } from "../errors";
import { BalanceService } from "../services/balance.service";
import { TYPES } from "../types/di.types";
import type { App } from "../utils/fastify";
import { logger } from "../utils/logger";

export async function balanceRoutes(fastify: App) {
  fastify.route({
    method: "GET",
    url: "/balance/:address",
    schema: {
      params: z.object({
        address: z.string(),
      }),
    },
    handler: async (request, reply) => {
      const { address } = request.params;
      const balanceService = container.get<BalanceService>(
        TYPES.BalanceService
      );

      const result = await balanceService.getBalance(address);

      if (result.isErr()) {
        const error = result.error;
        const statusCode = getErrorStatusCode(error);

        logger.error(error, "Error getting balance");

        return reply.status(statusCode).send({ error: error.message });
      }

      return reply.send({ balance: result.value });
    },
  });
}
