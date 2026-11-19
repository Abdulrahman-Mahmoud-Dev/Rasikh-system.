
import fp from "fastify-plugin";
import { Pool } from "pg";
import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
  }
}

const databasePlugin: FastifyPluginAsync = async (app) => {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on("error", (error) => {
    app.log.error({ err: error }, "Unexpected PostgreSQL pool error");
  });

  app.decorate("db", pool);

  app.addHook("onClose", async () => {
    await pool.end();
  });
};

export default fp(databasePlugin, {
  name: "database",
});
