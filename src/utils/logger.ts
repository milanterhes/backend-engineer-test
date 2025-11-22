import { pino } from "pino";
import { isDevelopment } from "./is-dev";

export const logger = pino(
  isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            singleLine: true,
          },
        },
      }
    : undefined
);
