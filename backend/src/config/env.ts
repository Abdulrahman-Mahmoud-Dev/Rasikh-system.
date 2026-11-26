import "dotenv/config";

import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const environmentSchema = z
  .object({
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
    COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),

    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(720)
      .default(12),

    CORS_ORIGIN: z.string().url(),

    // EmailJS identifiers are not passwords. The private key, when enabled,
    // is a secret and must be stored only in the backend host's secret store.
    EMAILJS_PUBLIC_KEY: z.string().min(5).optional(),
    EMAILJS_PRIVATE_KEY: z.string().min(8).optional(),
    EMAILJS_SERVICE_ID: z.string().min(3).optional(),
    EMAILJS_INVITATION_TEMPLATE_ID: z.string().min(3).optional(),
    EMAILJS_ACCOUNT_TEMPLATE_ID: z.string().min(3).optional(),

    // Legacy OTP endpoint kept for backwards compatibility; the new UI uses password/Google.
    RESEND_API_KEY: z.string().min(10).optional(),
    EMAIL_FROM: z.string().min(3).optional(),

    // Google Web OAuth client ID is public. The server validates every ID token.
    GOOGLE_CLIENT_ID: z.string().min(20).optional(),

    // Full public URL of the deployed Rasikh frontend, without a trailing slash.
    PUBLIC_APP_URL: z.string().url().optional(),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .superRefine((value, context) => {
    if (value.COOKIE_SAME_SITE === "none" && !value.COOKIE_SECURE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["COOKIE_SECURE"],
        message: "COOKIE_SECURE must be true when COOKIE_SAME_SITE is none.",
      });
    }
    if (value.NODE_ENV === "production" && !value.COOKIE_SECURE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["COOKIE_SECURE"],
        message: "COOKIE_SECURE must be true in production.",
      });
    }
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
