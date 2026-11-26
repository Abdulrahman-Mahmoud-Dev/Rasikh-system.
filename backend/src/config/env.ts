
import "dotenv/config";

import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  HOST: z.string().min(1).default("127.0.0.1"),

  PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3000),

  DATABASE_URL: z
    .string()
    .url()
    .startsWith("postgresql://"),

  COOKIE_SECRET: z
    .string()
    .min(32, "COOKIE_SECRET must contain at least 32 characters"),

  COOKIE_SECURE: booleanFromString.default("false"),

  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(720)
    .default(12),

  CORS_ORIGIN: z.string().url(),

  // Transactional email (Resend). Optional at startup; required for OTP delivery.
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  AUTH_EMAIL_FROM: z.string().trim().min(3).optional(),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

const result = environmentSchema.safeParse(process.env);

if (!result.success) {
  const details = result.error.issues
    .map((issue) => {
      const field = issue.path.join(".");
      return `- ${field}: ${issue.message}`;
    })
    .join("\n");

  throw new Error(
    `Invalid environment configuration:\n${details}`,
  );
}

export const env = Object.freeze(result.data);

export type Environment = typeof env;
