import Fastify from "fastify";
import type { Pool } from "pg";
import { ZodError } from "zod";

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";

import { env } from "./config/env.js";
import associationsRoutes from "./modules/associations/associations.routes.js";
import auditRoutes from "./modules/audit/audit.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import authAccountsRoutes from "./modules/auth/auth-accounts.routes.js";
import educationRoutes from "./modules/education/education.routes.js";
import peopleRoutes from "./modules/people/people.routes.js";
import studentsRoutes from "./modules/students/students.routes.js";
import authenticationPlugin from "./plugins/authentication.js";
import databasePlugin from "./plugins/database.js";
import healthRoute from "./routes/health.js";
import { AppError } from "./shared/errors/app-error.js";

export interface BuildAppOptions {
  pool?: Pool;
  logger?: boolean;
}

function getPgErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export function buildApp(options?: BuildAppOptions) {
  const app = Fastify({
    logger:
      options?.logger === false
        ? false
        : {
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

  app.register(databasePlugin, { pool: options?.pool });
  app.register(authenticationPlugin);
  app.register(healthRoute);

  app.register(
    async (api) => {
      api.register(authRoutes);
      api.register(authAccountsRoutes);
      api.register(associationsRoutes);
      api.register(peopleRoutes);
      api.register(studentsRoutes);
      api.register(educationRoutes);
      api.register(auditRoutes);
    },
    { prefix: "/api/v1" },
  );

  // Centralized error handling
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn(
        { code: error.code, statusCode: error.statusCode },
        "Domain request error",
      );
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "البيانات المدخلة غير صالحة.",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
    }

    const pgCode = getPgErrorCode(error);
    if (pgCode === "23505") {
      return reply.status(409).send({
        error: {
          code: "CONFLICT",
          message: "يوجد سجل مطابق مسجل مسبقًا.",
        },
      });
    }
    if (pgCode === "23503") {
      return reply.status(400).send({
        error: {
          code: "INVALID_REFERENCE",
          message: "العنصر المرتبط غير موجود أو لا ينتمي لنفس الجمعية.",
        },
      });
    }

    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const isServerError = statusCode >= 500;

    if (isServerError) {
      request.log.error({ err: error }, "Unhandled server error");
    } else {
      request.log.warn({ err: error }, "Request rejected");
    }

    return reply.status(statusCode).send({
      error: {
        code: isServerError ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR",
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
