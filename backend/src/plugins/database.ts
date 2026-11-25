
import fp from "fastify-plugin";
import { Pool } from "pg";
import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
  }
}

export interface DatabasePluginOptions {
  pool?: Pool;
}

const databasePlugin: FastifyPluginAsync<DatabasePluginOptions> = async (
  app,
  options,
) => {
  const ownsPool = !options.pool;
  const pool =
    options.pool ??
    new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

  if (ownsPool) {
    pool.on("error", (error) => {
      app.log.error({ err: error }, "Unexpected PostgreSQL pool error");
    });
  }

  app.decorate("db", pool);

  app.addHook("onClose", async () => {
    if (ownsPool) {
      await pool.end();
    }
  });
};

export default fp(databasePlugin, {
  name: "database",
});
