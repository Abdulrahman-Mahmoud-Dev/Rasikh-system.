
import type { FastifyPluginAsync } from "fastify";

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    return reply.status(200).send({
      status: "ok",
      service: "rasikh-backend",
      timestamp: new Date().toISOString(),
    });
  });
};

export default healthRoute;
