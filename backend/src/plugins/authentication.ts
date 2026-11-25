import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { env } from "../config/env.js";
import { UnauthorizedError } from "../shared/errors/app-error.js";
import { hashSecret } from "../shared/utilities/crypto.js";

export const SESSION_COOKIE_NAME = "rasikh_session";

export interface AuthContext {
  sessionId: string;
  accountId: string;
  personId: string;
  fullName: string;
  fileNumber: string;
  platformRole: "platform_admin" | "platform_deputy" | null;
}

interface SessionQueryRow {
  session_id: string;
  account_id: string;
  person_id: string;
  full_name: string;
  file_number: string;
  platform_role: "platform_admin" | "platform_deputy" | null;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const authenticationPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request) => {
    const rawCookie = request.cookies[SESSION_COOKIE_NAME];
    if (!rawCookie) {
      request.auth = null;
      return;
    }

    const unsigned = request.unsignCookie(rawCookie);
    if (!unsigned.valid || !unsigned.value) {
      request.auth = null;
      return;
    }

    const tokenHash = hashSecret(unsigned.value, env.COOKIE_SECRET);
    const result = await app.db.query<SessionQueryRow>(
      `SELECT
         s.id AS session_id,
         s.account_id,
         s.person_id,
         p.full_name,
         p.file_number,
         ua.platform_role
       FROM public.auth_sessions s
       INNER JOIN public.user_accounts ua
         ON ua.id = s.account_id AND ua.person_id = s.person_id
       INNER JOIN public.persons p
         ON p.id = s.person_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND ua.status = 'active'
         AND p.lifecycle_status = 'active'
       LIMIT 1`,
      [tokenHash],
    );

    const row = result.rows[0];
    if (!row) {
      request.auth = null;
      return;
    }

    request.auth = {
      sessionId: row.session_id,
      accountId: row.account_id,
      personId: row.person_id,
      fullName: row.full_name,
      fileNumber: row.file_number,
      platformRole: row.platform_role,
    };
  });
};

export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.auth) {
    throw new UnauthorizedError();
  }
}

export function getRequiredAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw new UnauthorizedError();
  }
  return request.auth;
}

export default fp(authenticationPlugin, {
  name: "authentication",
  dependencies: ["database"],
});
