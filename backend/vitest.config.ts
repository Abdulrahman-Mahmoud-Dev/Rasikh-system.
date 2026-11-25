import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "3000",
      DATABASE_URL: "postgresql://rasikh_app:test_only_password@127.0.0.1:5432/rasikh_test",
      COOKIE_SECRET: "rasikh_test_cookie_secret_minimum_32_characters_long",
      COOKIE_SECURE: "false",
      SESSION_TTL_HOURS: "12",
      CORS_ORIGIN: "http://localhost:5500",
      LOG_LEVEL: "silent",
    },
  },
});
