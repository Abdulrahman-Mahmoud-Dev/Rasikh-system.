
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = buildApp();

const start = async (): Promise<void> => {
  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });
  } catch (error) {
    app.log.error(error, "Failed to start the server");
    process.exitCode = 1;
  }
};

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "Shutting down server");

  try {
    await app.close();
    app.log.info("Server closed successfully");
  } catch (error) {
    app.log.error(error, "Error while closing server");
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void start();
