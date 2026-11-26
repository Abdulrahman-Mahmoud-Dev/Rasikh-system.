import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { withTransaction } from "../../db/transaction.js";
import {
  getRequiredAuth,
  requireAuth,
  SESSION_COOKIE_NAME,
} from "../../plugins/authentication.js";
import {
  TooManyRequestsError,
  UnauthorizedError,
} from "../../shared/errors/app-error.js";
import {
  generateOpaqueToken,
  generateOtpCode,
  generateUuid,
  hashSecret,
  timingSafeHexEqual,
} from "../../shared/utilities/crypto.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { sendLoginOtpEmail } from "./otp-email.service.js";

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

const otpRequestSchema = z.object({
  email: z.string().trim().email().max(255),
});

const otpVerifySchema = z.object({
  email: z.string().trim().email().max(255),
  code: z.string().regex(/^\d{6}$/, "رمز التحقق يجب أن يتكون من 6 أرقام."),
});

interface ChallengeRow {
  id: string;
  otp_hash: string;
  attempt_count: number;
  max_attempts: number;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

interface AccountLookupRow {
  account_id: string;
  person_id: string;
  full_name: string;
  file_number: string;
  account_status: string;
  platform_role: "platform_admin" | "platform_deputy" | null;
}

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/auth/otp/request",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = otpRequestSchema.parse(request.body);
      const normalizedEmail = body.email.trim().toLowerCase();

      // Only send sign-in codes to email addresses linked to active accounts.
      const accountLookup = await app.db.query<{ account_exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM public.persons p
           INNER JOIN public.user_accounts ua ON ua.person_id = p.id
           WHERE lower(btrim(p.email)) = $1
             AND p.lifecycle_status = 'active'
             AND ua.status <> 'disabled'
         ) AS account_exists`,
        [normalizedEmail],
      );

      if (!accountLookup.rows[0]?.account_exists) {
        return reply.status(200).send({
          message: "إذا كان البريد الإلكتروني مرتبطًا بحساب نشط، فسيصلك رمز التحقق.",
          expiresInSeconds: OTP_TTL_MINUTES * 60,
        });
      }

      const otpCode = generateOtpCode();
      const otpHash = hashSecret(otpCode, env.COOKIE_SECRET);
      const challengeId = generateUuid();
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

      // Do not claim success unless the email provider accepts the message.
      await sendLoginOtpEmail(normalizedEmail, otpCode, challengeId);

      await app.db.query(
        `INSERT INTO public.login_challenges (
           id,
           identifier_type,
           identifier_value,
           channel,
           otp_hash,
           max_attempts,
           expires_at
         )
         VALUES ($1, 'email', $2, 'email', $3, $4, $5)`,
        [
          challengeId,
          normalizedEmail,
          otpHash,
          OTP_MAX_ATTEMPTS,
          expiresAt.toISOString(),
        ],
      );

      request.log.info(
        { challengeId, channel: "email" },
        "Login OTP email accepted by provider",
      );

      return reply.status(200).send({
        message: "تم إرسال طلب رمز التحقق إلى بريدك الإلكتروني. تحقق أيضًا من مجلد الرسائل غير المرغوب فيها.",
        expiresInSeconds: OTP_TTL_MINUTES * 60,
      });
    },
  );

  app.post(
    "/auth/otp/verify",
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = otpVerifySchema.parse(request.body);
      const normalizedEmail = body.email.trim().toLowerCase();

      const sessionResult = await withTransaction(app.db, async (client) => {
        const challengeRes = await client.query<ChallengeRow>(
          `SELECT
             id,
             otp_hash,
             attempt_count,
             max_attempts,
             expires_at,
             consumed_at
           FROM public.login_challenges
           WHERE identifier_type = $1
             AND identifier_value = $2
           ORDER BY created_at DESC
           LIMIT 1
           FOR UPDATE`,
          ["email", normalizedEmail],
        );

        const challenge = challengeRes.rows[0];
        if (!challenge || challenge.consumed_at !== null) {
          throw new UnauthorizedError(
            "رمز التحقق غير صالح أو مستخدم مسبقًا.",
            "INVALID_OTP_CHALLENGE",
          );
        }

        if (new Date(challenge.expires_at).getTime() <= Date.now()) {
          throw new UnauthorizedError(
            "انتهت صلاحية رمز التحقق، يرجى طلب رمز جديد.",
            "OTP_EXPIRED",
          );
        }

        if (challenge.attempt_count >= challenge.max_attempts) {
          throw new TooManyRequestsError(
            "تم استنفاد عدد المحاولات المسموحة لهذا الرمز.",
            "OTP_MAX_ATTEMPTS_EXCEEDED",
          );
        }

        const candidateHash = hashSecret(body.code, env.COOKIE_SECRET);
        if (!timingSafeHexEqual(candidateHash, challenge.otp_hash)) {
          await client.query(
            `UPDATE public.login_challenges
             SET attempt_count = attempt_count + 1
             WHERE id = $1`,
            [challenge.id],
          );
          throw new UnauthorizedError(
            "رمز التحقق غير صحيح.",
            "OTP_MISMATCH",
          );
        }

        const accountRes = await client.query<AccountLookupRow>(
          `SELECT
             ua.id AS account_id,
             p.id AS person_id,
             p.full_name,
             p.file_number,
             ua.status AS account_status,
             ua.platform_role
           FROM public.persons p
           INNER JOIN public.user_accounts ua
             ON ua.person_id = p.id
           WHERE lower(btrim(p.email)) = $1
             AND p.lifecycle_status = 'active'
           LIMIT 1`,
          [normalizedEmail],
        );

        const account = accountRes.rows[0];
        if (!account || account.account_status === "disabled") {
          throw new UnauthorizedError(
            "الحساب غير مفعل أو غير مصرح له بالدخول.",
            "ACCOUNT_UNAVAILABLE",
          );
        }

        await client.query(
          `UPDATE public.login_challenges
           SET consumed_at = now()
           WHERE id = $1`,
          [challenge.id],
        );

        if (account.account_status === "pending") {
          await client.query(
            `UPDATE public.user_accounts
             SET status = 'active', updated_at = now()
             WHERE id = $1`,
            [account.account_id],
          );
        }

        const rawToken = generateOpaqueToken();
        const tokenHash = hashSecret(rawToken, env.COOKIE_SECRET);
        const sessionId = generateUuid();
        const expiresAt = new Date(
          Date.now() + env.SESSION_TTL_HOURS * 3_600_000,
        );

        await client.query(
          `INSERT INTO public.auth_sessions (
             id,
             account_id,
             person_id,
             token_hash,
             user_agent,
             expires_at
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            sessionId,
            account.account_id,
            account.person_id,
            tokenHash,
            request.headers["user-agent"] ?? null,
            expiresAt.toISOString(),
          ],
        );

        await recordAuditEvent(client, {
          associationId: null,
          actorPersonId: account.person_id,
          eventType: "auth.session_created",
          entityType: "auth_session",
          entityId: sessionId,
          newData: { channel: "email" },
        });

        return {
          rawToken,
          expiresAt,
          account,
        };
      });

      reply.setCookie(SESSION_COOKIE_NAME, sessionResult.rawToken, {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: env.COOKIE_SAME_SITE,
        signed: true,
        path: "/",
        expires: sessionResult.expiresAt,
      });

      return reply.status(200).send({
        user: {
          personId: sessionResult.account.person_id,
          accountId: sessionResult.account.account_id,
          fullName: sessionResult.account.full_name,
          fileNumber: sessionResult.account.file_number,
          platformRole: sessionResult.account.platform_role,
        },
      });
    },
  );

  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const auth = getRequiredAuth(request);

    const membershipsResult = await app.db.query(
      `SELECT
         m.id AS membership_id,
         m.association_id,
         a.name AS association_name,
         a.workspace_kind,
         a.status AS association_status,
         m.status AS membership_status,
         ra.id AS role_assignment_id,
         ra.role_code,
         ra.scope_type,
         ra.branch_id,
         ra.quranic_premise_id,
         ra.circle_id,
         circle_premise.id AS assigned_premise_id,
         circle_premise.name AS assigned_premise_name,
         ra.circle_id AS assigned_circle_id,
         assigned_circle.name AS assigned_circle_name,
         assigned_circle.study_period AS assigned_circle_period,
         COALESCE(ra.branch_id, circle_premise.branch_id) AS assigned_branch_id,
         assigned_branch.display_name AS assigned_branch_name,
         ra.granted_permissions
       FROM public.association_memberships m
       INNER JOIN public.associations a
         ON a.id = m.association_id
       LEFT JOIN public.role_assignments ra
         ON ra.membership_id = m.id
         AND ra.association_id = m.association_id
         AND ra.valid_from <= now()
         AND (ra.valid_until IS NULL OR ra.valid_until > now())
       LEFT JOIN public.circles assigned_circle
         ON assigned_circle.id = ra.circle_id
         AND assigned_circle.association_id = ra.association_id
       LEFT JOIN public.quranic_premises circle_premise
         ON circle_premise.id = COALESCE(ra.quranic_premise_id, assigned_circle.quranic_premise_id)
         AND circle_premise.association_id = ra.association_id
       LEFT JOIN public.branches assigned_branch
         ON assigned_branch.id = COALESCE(ra.branch_id, circle_premise.branch_id)
         AND assigned_branch.association_id = ra.association_id
       WHERE m.person_id = $1
         AND m.status = 'active'
         AND m.valid_from <= now()
         AND (m.valid_until IS NULL OR m.valid_until > now())
       ORDER BY a.name ASC`,
      [auth.personId],
    );

    return reply.status(200).send({
      user: {
        personId: auth.personId,
        accountId: auth.accountId,
        fullName: auth.fullName,
        fileNumber: auth.fileNumber,
        platformRole: auth.platformRole,
      },
      assignments: membershipsResult.rows,
    });
  });

  app.post(
    "/auth/logout",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);

      await app.db.query(
        `UPDATE public.auth_sessions
         SET revoked_at = now()
         WHERE id = $1`,
        [auth.sessionId],
      );

      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return reply.status(200).send({
        message: "تم تسجيل الخروج بنجاح.",
      });
    },
  );
};

export default authRoutes;
