import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { logger } from "./logger";

const app = Fastify({
  loggerInstance: logger,
}).withTypeProvider<ZodTypeProvider>();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// Request logging
app.addHook("onRequest", async (request, reply) => {
  const requestId = request.id;
  logger.info(
    {
      requestId,
      method: request.method,
      url: request.url,
      headers: request.headers,
    },
    "Incoming request"
  );
});

// Response logging
app.addHook("onResponse", async (request, reply) => {
  const requestId = request.id;
  const responseTime = reply.elapsedTime;
  logger.info(
    {
      requestId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: `${responseTime.toFixed(2)}ms`,
    },
    "Request completed"
  );
});

// Global error handler
app.setErrorHandler((error, request, reply) => {
  const requestId = request.id;
  const statusCode = reply.statusCode || 500;

  // Type guard for Error
  const errorObj = error instanceof Error ? error : new Error(String(error));

  // Log the error with full context
  logger.error(
    {
      requestId,
      method: request.method,
      url: request.url,
      statusCode,
      error: {
        name: errorObj.name,
        message: errorObj.message,
        stack: errorObj.stack,
        cause: errorObj.cause,
      },
    },
    "Unhandled error in request"
  );

  // Send error response
  reply.status(statusCode).send({
    error: errorObj.message || "Internal server error",
  });
});

export type App = typeof app;

export default app;
