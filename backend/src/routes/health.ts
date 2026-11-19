
import type { FastifyPluginAsync } from "fastify";

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    return reply.status(200).send({
      status: "ok",
      service: "rasikh-backend",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/health/ready", async (_request, reply) => {
    try {
      await app.db.query("SELECT 1");

      return reply.status(200).send({
        status: "ready",
        database: "connected",
      });
    } catch (error) {
      app.log.error({ err: error }, "Database readiness check failed");

      return reply.status(503).send({
        status: "not_ready",
        database: "unavailable",
      });
    }
  });
};

export default healthRoute;
