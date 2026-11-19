
import Fastify from "fastify";

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";

import { env } from "./config/env.js";

import healthRoute from "./routes/health.js";

export function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },

    bodyLimit: 1024 * 1024,

    requestTimeout: 30_000,
  });

  // Security headers
  app.register(helmet);

  // Frontend access policy
  app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });

  // Cookie signing support
  app.register(cookie, {
    secret: env.COOKIE_SECRET,
  });

  // General request rate limit
  app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

app.register(healthRoute);
  
  // Centralized error handling
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const isServerError = statusCode >= 500;

    if (isServerError) {
      request.log.error(
        { err: error },
        "Unhandled server error",
      );
    } else {
      request.log.warn(
        { err: error },
        "Request rejected",
      );
    }

    return reply.status(statusCode).send({
      error: {
        code: isServerError
          ? "INTERNAL_SERVER_ERROR"
          : "REQUEST_ERROR",

        message: isServerError
          ? "حدث خطأ داخلي في الخادم."
          : "الطلب غير صالح أو تعذر تنفيذه.",
      },
    });
  });

  // Unknown routes
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "المسار المطلوب غير موجود.",
      },
    });
  });

  return app;
}
