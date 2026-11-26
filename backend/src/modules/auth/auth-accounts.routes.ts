import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { withTransaction, type Queryable } from "../../db/transaction.js";
import {
  getRequiredAuth,
  requireAuth,
  SESSION_COOKIE_NAME,
} from "../../plugins/authentication.js";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from "../../shared/errors/app-error.js";
import {
  generateFileNumber,
  generateOpaqueToken,
  generateUuid,
  hashSecret,
} from "../../shared/utilities/crypto.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { sendAccountEmail } from "./email.service.js";
import { verifyGoogleIdToken } from "./google-identity.service.js";
import { hashPassword, verifyPassword } from "./password.service.js";

const emailSchema = z.string().trim().email().max(255).transform((value) => value.toLowerCase());

const registerSchema = z.object({
  fullName: z.string().trim().min(3).max(200),
  email: emailSchema,
  password: z.string().min(12).max(128),
});

const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

const tokenSchema = z.object({
  token: z.string().min(24).max(512),
});

const passwordResetSchema = z.object({
  token: z.string().min(24).max(512),
  password: z.string().min(12).max(128),
});

const googleLoginSchema = z.object({
  credential: z.string().min(100).max(10_000),
  nonce: z.string().min(24).max(512),
});

const googleLinkSchema = googleLoginSchema;

const invitationPreviewParams = z.object({
  token: z.string().min(24).max(512),
});

const invitationRegistrationSchema = z.object({
  token: z.string().min(24).max(512),
  fullName: z.string().trim().min(3).max(200),
  password: z.string().min(12).max(128),
});

interface AccountRow {
  account_id: string;
  person_id: string;
  full_name: string;
  file_number: string;
  account_status: string;
  password_hash: string | null;
  email: string;
  email_verified_at: Date | string | null;
  platform_role: "platform_admin" | "platform_deputy" | null;
}

interface InvitationRegistrationRow {
  id: string;
  association_id: string;
  recipient_email: string;
  role_code: string;
  scope_type: string;
  branch_id: string | null;
  quranic_premise_id: string | null;
  circle_id: string | null;
  target_student_id: string | null;
  relationship_label: string | null;
  granted_permissions: string[];
  status: string;
  expires_at: Date | string;
  association_name: string;
}

interface SessionResult {
  rawToken: string;
  expiresAt: Date;
  account: {
    account_id: string;
    person_id: string;
    full_name: string;
    file_number: string;
    platform_role: "platform_admin" | "platform_deputy" | null;
  };
}

function requirePublicAppUrl(): string {
  if (!env.PUBLIC_APP_URL) {
    throw new AppError(
      503,
      "PUBLIC_APP_URL_NOT_CONFIGURED",
      "رابط موقع راسخ غير مضبوط في إعدادات الخادم.",
    );
  }
  return env.PUBLIC_APP_URL.replace(/\/$/, "");
}

async function reserveFileNumber(
  client: Queryable,
  fullName: string,
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateFileNumber(fullName);
    const result = await client.query(
      `INSERT INTO public.reserved_file_numbers (file_number)
       VALUES ($1)
       ON CONFLICT (file_number) DO NOTHING
       RETURNING file_number`,
      [candidate],
    );
    if (result.rows[0]) return candidate;
  }
  throw new ConflictError(
    "تعذر إنشاء الرقم التعريفي، حاول مرة أخرى.",
    "FILE_NUMBER_GENERATION_FAILED",
  );
}

async function insertSession(
  client: Queryable,
  request: FastifyRequest,
  account: SessionResult["account"],
): Promise<SessionResult> {
  const rawToken = generateOpaqueToken();
  const tokenHash = hashSecret(rawToken, env.COOKIE_SECRET);
  const sessionId = generateUuid();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);

  await client.query(
    `INSERT INTO public.auth_sessions (
       id, account_id, person_id, token_hash, user_agent, expires_at
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

  await recordAuditEvent(client as never, {
    associationId: null,
    actorPersonId: account.person_id,
    eventType: "auth.session_created",
    entityType: "auth_session",
    entityId: sessionId,
    newData: { channel: "account" },
  });

  return { rawToken, expiresAt, account };
}

function setSessionCookie(reply: {
  setCookie: (name: string, value: string, options: Record<string, unknown>) => unknown;
}, session: SessionResult): void {
  reply.setCookie(SESSION_COOKIE_NAME, session.rawToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    signed: true,
    path: "/",
    expires: session.expiresAt,
  });
}

async function loadAccountByEmail(
  db: Queryable,
  email: string,
): Promise<AccountRow | undefined> {
  const result = await db.query<AccountRow>(
    `SELECT
       ua.id AS account_id,
       p.id AS person_id,
       p.full_name,
       p.file_number,
       ua.status AS account_status,
       ua.password_hash,
       lower(btrim(p.email)) AS email,
       p.email_verified_at,
       ua.platform_role
     FROM public.persons p
     INNER JOIN public.user_accounts ua ON ua.person_id = p.id
     WHERE lower(btrim(p.email)) = $1
       AND p.lifecycle_status = 'active'
     LIMIT 1`,
    [email],
  );
  return result.rows[0];
}

async function createAccountForNewPerson(
  client: Queryable,
  input: {
    fullName: string;
    email: string;
    passwordHash: string | null;
    emailVerified: boolean;
  },
): Promise<SessionResult["account"]> {
  const personId = generateUuid();
  const accountId = generateUuid();
  const fileNumber = await reserveFileNumber(client, input.fullName);

  await client.query(
    `INSERT INTO public.persons (
       id, file_number, full_name, phone, email, email_verified_at
     )
     VALUES ($1, $2, $3, NULL, $4, $5)`,
    [
      personId,
      fileNumber,
      input.fullName,
      input.email,
      input.emailVerified ? new Date().toISOString() : null,
    ],
  );

  await client.query(
    `INSERT INTO public.user_accounts (id, person_id, status, password_hash)
     VALUES ($1, $2, $3, $4)`,
    [
      accountId,
      personId,
      input.emailVerified ? "active" : "pending",
      input.passwordHash,
    ],
  );

  return {
    account_id: accountId,
    person_id: personId,
    full_name: input.fullName,
    file_number: fileNumber,
    platform_role: null,
  };
}

async function createEmailToken(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  accountId: string,
  personId: string,
  purpose: "email_verification" | "password_reset",
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateOpaqueToken();
  const tokenHash = hashSecret(rawToken, env.COOKIE_SECRET);
  const expiresAt = new Date(Date.now() + 30 * 60_000);

  await client.query(
    `INSERT INTO public.account_email_tokens (
       id, account_id, person_id, purpose, token_hash, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      generateUuid(),
      accountId,
      personId,
      purpose,
      tokenHash,
      expiresAt.toISOString(),
    ],
  );

  return { rawToken, expiresAt };
}

const authAccountsRoutes: FastifyPluginAsync = async (app) => {
  // Manual registration: no phone number is required for the login account.
  // Ownership of the email is confirmed once through a single-use email link.
  app.post(
    "/auth/register",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const body = registerSchema.parse(request.body);
      const publicUrl = requirePublicAppUrl();
      const passwordHash = await hashPassword(body.password);

      const created = await withTransaction(app.db, async (client) => {
        const existing = await client.query<{ id: string }>(
          `SELECT p.id
           FROM public.persons p
           WHERE lower(btrim(p.email)) = $1
           LIMIT 1`,
          [body.email],
        );
        if (existing.rows[0]) {
          throw new ConflictError(
            "هذا البريد مرتبط بملف سابق. سجّل الدخول أو افتح الدعوة المرسلة إليه.",
            "EMAIL_ALREADY_REGISTERED",
          );
        }

        const account = await createAccountForNewPerson(client, {
          fullName: body.fullName,
          email: body.email,
          passwordHash,
          emailVerified: false,
        });
        const emailToken = await createEmailToken(
          client,
          account.account_id,
          account.person_id,
          "email_verification",
        );

        return { account, emailToken };
      });

      try {
        await sendAccountEmail(
          body.email,
          body.fullName,
          "email_verification",
          `${publicUrl}/?verifyEmail=${encodeURIComponent(created.emailToken.rawToken)}`,
        );
      } catch (error) {
        await app.db.query(
          `UPDATE public.account_email_tokens
           SET consumed_at = now()
           WHERE account_id = $1 AND purpose = 'email_verification' AND consumed_at IS NULL`,
          [created.account.account_id],
        );
        throw error;
      }

      return reply.status(202).send({
        message: "أرسلنا رسالة لتأكيد البريد الإلكتروني. افتح الرابط لإكمال إنشاء حسابك.",
      });
    },
  );

  app.post(
    "/auth/email/verify",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const body = tokenSchema.parse(request.body);
      const tokenHash = hashSecret(body.token, env.COOKIE_SECRET);

      const session = await withTransaction(app.db, async (client) => {
        const tokenResult = await client.query<{
          id: string;
          account_id: string;
          person_id: string;
          expires_at: Date | string;
          consumed_at: Date | string | null;
        }>(
          `SELECT id, account_id, person_id, expires_at, consumed_at
           FROM public.account_email_tokens
           WHERE token_hash = $1 AND purpose = 'email_verification'
           FOR UPDATE`,
          [tokenHash],
        );
        const token = tokenResult.rows[0];
        if (
          !token ||
          token.consumed_at ||
          new Date(token.expires_at).getTime() <= Date.now()
        ) {
          throw new BadRequestError(
            "رابط تأكيد البريد غير صالح أو انتهت صلاحيته.",
            "EMAIL_VERIFICATION_TOKEN_INVALID",
          );
        }

        await client.query(
          `UPDATE public.account_email_tokens
           SET consumed_at = now()
           WHERE id = $1`,
          [token.id],
        );
        await client.query(
          `UPDATE public.persons
           SET email_verified_at = now(), updated_at = now()
           WHERE id = $1`,
          [token.person_id],
        );
        await client.query(
          `UPDATE public.user_accounts
           SET status = 'active', updated_at = now()
           WHERE id = $1 AND status = 'pending'`,
          [token.account_id],
        );

        const accountResult = await client.query<AccountRow>(
          `SELECT
             ua.id AS account_id,
             p.id AS person_id,
             p.full_name,
             p.file_number,
             ua.status AS account_status,
             ua.password_hash,
             lower(btrim(p.email)) AS email,
             p.email_verified_at,
             ua.platform_role
           FROM public.user_accounts ua
           INNER JOIN public.persons p ON p.id = ua.person_id
           WHERE ua.id = $1
           LIMIT 1`,
          [token.account_id],
        );
        const account = accountResult.rows[0];
        if (!account) {
          throw new UnauthorizedError("تعذر العثور على الحساب بعد تأكيد البريد.");
        }

        return insertSession(client, request, account);
      });

      setSessionCookie(reply, session);
      return reply.status(200).send({
        message: "تم تأكيد بريدك الإلكتروني وتفعيل الحساب.",
        user: {
          personId: session.account.person_id,
          accountId: session.account.account_id,
          fullName: session.account.full_name,
          fileNumber: session.account.file_number,
          platformRole: session.account.platform_role,
        },
      });
    },
  );

  app.post(
    "/auth/password/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const body = passwordLoginSchema.parse(request.body);
      const account = await loadAccountByEmail(app.db, body.email);

      if (
        !account ||
        !account.password_hash ||
        account.account_status !== "active" ||
        !account.email_verified_at
      ) {
        throw new UnauthorizedError(
          "البريد أو كلمة المرور غير صحيحة، أو لم يتم تأكيد البريد بعد.",
          "INVALID_LOGIN",
        );
      }

      const matches = await verifyPassword(body.password, account.password_hash);
      if (!matches) {
        throw new UnauthorizedError(
          "البريد أو كلمة المرور غير صحيحة.",
          "INVALID_LOGIN",
        );
      }

      const session = await withTransaction(app.db, async (client) =>
        insertSession(client, request, account),
      );
      setSessionCookie(reply, session);

      return reply.status(200).send({
        user: {
          personId: session.account.person_id,
          accountId: session.account.account_id,
          fullName: session.account.full_name,
          fileNumber: session.account.file_number,
          platformRole: session.account.platform_role,
        },
      });
    },
  );

  app.post(
    "/auth/password-reset/request",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const body = z.object({ email: emailSchema }).parse(request.body);
      const account = await loadAccountByEmail(app.db, body.email);

      // The response does not disclose whether the email exists.
      if (
        account &&
        account.account_status === "active" &&
        account.email_verified_at
      ) {
        const publicUrl = requirePublicAppUrl();
        const token = await withTransaction(app.db, async (client) =>
          createEmailToken(
            client,
            account.account_id,
            account.person_id,
            "password_reset",
          ),
        );
        await sendAccountEmail(
          account.email,
          account.full_name,
          "password_reset",
          `${publicUrl}/?resetPassword=${encodeURIComponent(token.rawToken)}`,
        );
      }

      return reply.status(202).send({
        message: "إذا كان البريد مرتبطًا بحساب نشط، فستصلك رسالة استعادة كلمة المرور.",
      });
    },
  );

  app.post(
    "/auth/password-reset/confirm",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const body = passwordResetSchema.parse(request.body);
      const newHash = await hashPassword(body.password);
      const tokenHash = hashSecret(body.token, env.COOKIE_SECRET);

      await withTransaction(app.db, async (client) => {
        const result = await client.query<{
          id: string;
          account_id: string;
          expires_at: Date | string;
          consumed_at: Date | string | null;
        }>(
          `SELECT id, account_id, expires_at, consumed_at
           FROM public.account_email_tokens
           WHERE token_hash = $1 AND purpose = 'password_reset'
           FOR UPDATE`,
          [tokenHash],
        );
        const token = result.rows[0];
        if (
          !token ||
          token.consumed_at ||
          new Date(token.expires_at).getTime() <= Date.now()
        ) {
          throw new BadRequestError(
            "رابط استعادة كلمة المرور غير صالح أو منتهي.",
            "PASSWORD_RESET_TOKEN_INVALID",
          );
        }

        await client.query(
          `UPDATE public.user_accounts
           SET password_hash = $2, status = 'active', updated_at = now()
           WHERE id = $1`,
          [token.account_id, newHash],
        );
        await client.query(
          `UPDATE public.account_email_tokens SET consumed_at = now() WHERE id = $1`,
          [token.id],
        );
        await client.query(
          `UPDATE public.auth_sessions
           SET revoked_at = now()
           WHERE account_id = $1 AND revoked_at IS NULL`,
          [token.account_id],
        );
      });

      return reply.status(200).send({
        message: "تم تغيير كلمة المرور. سجّل الدخول بكلمتك الجديدة.",
      });
    },
  );

  app.post(
    "/auth/google/nonce",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (_request, reply) => {
      if (!env.GOOGLE_CLIENT_ID) {
        throw new AppError(
          503,
          "GOOGLE_SIGN_IN_NOT_CONFIGURED",
          "تسجيل الدخول باستخدام Google يحتاج إلى إعداد Client ID في الخادم.",
        );
      }

      const nonce = generateOpaqueToken();
      await app.db.query(
        `INSERT INTO public.auth_nonce_challenges (id, nonce_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [
          generateUuid(),
          hashSecret(nonce, env.COOKIE_SECRET),
          new Date(Date.now() + 5 * 60_000).toISOString(),
        ],
      );

      return reply.status(200).send({
        nonce,
        clientId: env.GOOGLE_CLIENT_ID,
      });
    },
  );

  async function authenticateGoogle(
    request: FastifyRequest,
    credential: string,
    nonce: string,
    currentPersonId?: string,
  ): Promise<SessionResult | null> {
    const identity = await verifyGoogleIdToken(credential, nonce);

    if (currentPersonId) {
      const session = await withTransaction(app.db, async (client) => {
        const nonceResult = await client.query<{ id: string; expires_at: Date | string; consumed_at: Date | string | null }>(
          `SELECT id, expires_at, consumed_at
           FROM public.auth_nonce_challenges
           WHERE nonce_hash = $1
           FOR UPDATE`,
          [hashSecret(nonce, env.COOKIE_SECRET)],
        );
        const nonceRow = nonceResult.rows[0];
        if (
          !nonceRow ||
          nonceRow.consumed_at ||
          new Date(nonceRow.expires_at).getTime() <= Date.now()
        ) {
          throw new UnauthorizedError("انتهت محاولة ربط Google أو سبق استخدامها.");
        }

        const current = await client.query<{ email: string; account_id: string }>(
          `SELECT lower(btrim(p.email)) AS email, ua.id AS account_id
           FROM public.persons p
           INNER JOIN public.user_accounts ua ON ua.person_id = p.id
           WHERE p.id = $1
           LIMIT 1`,
          [currentPersonId],
        );
        const currentAccount = current.rows[0];
        if (!currentAccount || currentAccount.email !== identity.email) {
          throw new ForbiddenError(
            "اربط حساب Google بالبريد نفسه المسجل في حساب راسخ.",
            "GOOGLE_EMAIL_MISMATCH",
          );
        }

        const conflict = await client.query<{ account_id: string }>(
          `SELECT account_id
           FROM public.auth_identities
           WHERE provider = 'google' AND provider_subject = $1
           LIMIT 1`,
          [identity.subject],
        );
        if (conflict.rows[0] && conflict.rows[0].account_id !== currentAccount.account_id) {
          throw new ConflictError("حساب Google مرتبط بحساب راسخ آخر.", "GOOGLE_IDENTITY_ALREADY_LINKED");
        }

        await client.query(
          `INSERT INTO public.auth_identities (
             id, account_id, person_id, provider, provider_subject, provider_email, last_used_at
           )
           VALUES ($1, $2, $3, 'google', $4, $5, now())
           ON CONFLICT (provider, provider_subject)
           DO UPDATE SET last_used_at = now()`,
          [
            generateUuid(),
            currentAccount.account_id,
            currentPersonId,
            identity.subject,
            identity.email,
          ],
        );
        await client.query(
          `UPDATE public.auth_nonce_challenges SET consumed_at = now() WHERE id = $1`,
          [nonceRow.id],
        );
        return null;
      });
      return session;
    }

    const session = await withTransaction(app.db, async (client) => {
      const nonceResult = await client.query<{ id: string; expires_at: Date | string; consumed_at: Date | string | null }>(
        `SELECT id, expires_at, consumed_at
         FROM public.auth_nonce_challenges
         WHERE nonce_hash = $1
         FOR UPDATE`,
        [hashSecret(nonce, env.COOKIE_SECRET)],
      );
      const nonceRow = nonceResult.rows[0];
      if (
        !nonceRow ||
        nonceRow.consumed_at ||
        new Date(nonceRow.expires_at).getTime() <= Date.now()
      ) {
        throw new UnauthorizedError("انتهت محاولة تسجيل Google أو سبق استخدامها.");
      }

      const linked = await client.query<AccountRow>(
        `SELECT
           ua.id AS account_id,
           p.id AS person_id,
           p.full_name,
           p.file_number,
           ua.status AS account_status,
           ua.password_hash,
           lower(btrim(p.email)) AS email,
           p.email_verified_at,
           ua.platform_role
         FROM public.auth_identities ai
         INNER JOIN public.user_accounts ua ON ua.id = ai.account_id
         INNER JOIN public.persons p ON p.id = ua.person_id
         WHERE ai.provider = 'google'
           AND ai.provider_subject = $1
           AND ua.status = 'active'
           AND p.lifecycle_status = 'active'
         LIMIT 1`,
        [identity.subject],
      );

      let account = linked.rows[0];
      if (!account) {
        const byEmail = await client.query<AccountRow>(
          `SELECT
             ua.id AS account_id,
             p.id AS person_id,
             p.full_name,
             p.file_number,
             ua.status AS account_status,
             ua.password_hash,
             lower(btrim(p.email)) AS email,
             p.email_verified_at,
             ua.platform_role
           FROM public.persons p
           INNER JOIN public.user_accounts ua ON ua.person_id = p.id
           WHERE lower(btrim(p.email)) = $1
             AND p.lifecycle_status = 'active'
           LIMIT 1
           FOR UPDATE OF ua`,
          [identity.email],
        );

        account = byEmail.rows[0];
        if (account && !identity.emailAuthoritative) {
          throw new ConflictError(
            "هذا البريد مرتبط بحساب سابق. سجّل الدخول بكلمة المرور أولًا ثم اربط Google من ملفك الشخصي.",
            "GOOGLE_LINK_REQUIRES_EXISTING_LOGIN",
          );
        }

        if (!account) {
          if (!identity.emailAuthoritative) {
            throw new UnauthorizedError(
              "هذا البريد ليس Gmail أو Google Workspace موثوقًا. أنشئ الحساب بالبريد وكلمة المرور وأكّد البريد أولًا.",
              "GOOGLE_EMAIL_VERIFICATION_REQUIRED",
            );
          }
          // A profile may already exist (for example, a person record created by
          // an association). Reuse it rather than creating a duplicate person.
          const personResult = await client.query<{ id: string; full_name: string; file_number: string; email_verified_at: Date | string | null }>(
            `SELECT id, full_name, file_number, email_verified_at
             FROM public.persons
             WHERE lower(btrim(email)) = $1 AND lifecycle_status = 'active'
             LIMIT 1
             FOR UPDATE`,
            [identity.email],
          );
          const existingPerson = personResult.rows[0];

          if (existingPerson) {
            const accountId = generateUuid();
            await client.query(
              `INSERT INTO public.user_accounts (id, person_id, status, password_hash)
               VALUES ($1, $2, 'active', NULL)`,
              [accountId, existingPerson.id],
            );
            await client.query(
              `UPDATE public.persons SET email_verified_at = COALESCE(email_verified_at, now())
               WHERE id = $1`,
              [existingPerson.id],
            );
            account = {
              account_id: accountId,
              person_id: existingPerson.id,
              full_name: existingPerson.full_name,
              file_number: existingPerson.file_number,
              account_status: "active",
              password_hash: null,
              email: identity.email,
              email_verified_at: existingPerson.email_verified_at ?? new Date(),
              platform_role: null,
            };
          } else {
            const created = await createAccountForNewPerson(client, {
              fullName: identity.name,
              email: identity.email,
              passwordHash: null,
              emailVerified: true,
            });
            account = {
              ...created,
              account_status: "active",
              password_hash: null,
              email: identity.email,
              email_verified_at: new Date(),
            };
          }
        } else if (account.account_status === "pending" && identity.emailAuthoritative) {
          await client.query(
            `UPDATE public.user_accounts SET status = 'active', updated_at = now() WHERE id = $1`,
            [account.account_id],
          );
          await client.query(
            `UPDATE public.persons SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`,
            [account.person_id],
          );
          account.account_status = "active";
          account.email_verified_at = new Date();
        }

        if (account.account_status === "disabled") {
          throw new UnauthorizedError("هذا الحساب موقوف ولا يمكن تسجيل الدخول.");
        }

        await client.query(
          `INSERT INTO public.auth_identities (
             id, account_id, person_id, provider, provider_subject, provider_email, last_used_at
           )
           VALUES ($1, $2, $3, 'google', $4, $5, now())`,
          [
            generateUuid(),
            account.account_id,
            account.person_id,
            identity.subject,
            identity.email,
          ],
        );
      }

      await client.query(
        `UPDATE public.auth_nonce_challenges SET consumed_at = now() WHERE id = $1`,
        [nonceRow.id],
      );
      return insertSession(client, request, account);
    });

    return session;
  }

  app.post(
    "/auth/google",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const body = googleLoginSchema.parse(request.body);
      const session = await authenticateGoogle(
        request,
        body.credential,
        body.nonce,
      );
      if (!session) {
        return reply.status(204).send();
      }
      setSessionCookie(reply, session);
      return reply.status(200).send({
        user: {
          personId: session.account.person_id,
          accountId: session.account.account_id,
          fullName: session.account.full_name,
          fileNumber: session.account.file_number,
          platformRole: session.account.platform_role,
        },
      });
    },
  );

  app.post(
    "/auth/google/link",
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = googleLinkSchema.parse(request.body);
      const auth = getRequiredAuth(request);
      await authenticateGoogle(request, body.credential, body.nonce, auth.personId);
      return reply.status(200).send({
        message: "تم ربط حساب Google بحساب راسخ الحالي.",
      });
    },
  );

  app.get(
    "/auth/invitations/:token/preview",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { token } = invitationPreviewParams.parse(request.params);
      const tokenHash = hashSecret(token, env.COOKIE_SECRET);
      const result = await app.db.query<InvitationRegistrationRow>(
        `SELECT
           i.id,
           i.association_id,
           i.recipient_email,
           i.role_code,
           i.scope_type,
           i.branch_id,
           i.quranic_premise_id,
           i.circle_id,
           i.target_student_id,
           i.relationship_label,
           i.granted_permissions,
           i.status,
           i.expires_at,
           a.name AS association_name
         FROM public.invitations i
         INNER JOIN public.associations a ON a.id = i.association_id
         WHERE i.token_hash = $1
         LIMIT 1`,
        [tokenHash],
      );
      const invitation = result.rows[0];
      if (
        !invitation ||
        invitation.status !== "pending" ||
        new Date(invitation.expires_at).getTime() <= Date.now()
      ) {
        throw new BadRequestError("الدعوة غير صالحة أو انتهت صلاحيتها.", "INVALID_INVITATION");
      }

      return reply.status(200).send({
        invitation: {
          email: invitation.recipient_email,
          organizationName: invitation.association_name,
          roleCode: invitation.role_code,
          scopeType: invitation.scope_type,
          expiresAt: invitation.expires_at,
          requiresNewAccount: true,
        },
      });
    },
  );

  // A new invitee creates an account only from the message sent to the invited
  // email. The invitation itself proves control of that mailbox; the email is
  // immutable and the role/permissions are taken only from the stored invitation.
  app.post(
    "/auth/invitations/register",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const body = invitationRegistrationSchema.parse(request.body);
      const passwordHash = await hashPassword(body.password);
      const tokenHash = hashSecret(body.token, env.COOKIE_SECRET);

      const session = await withTransaction(app.db, async (client) => {
        const invitationResult = await client.query<InvitationRegistrationRow>(
          `SELECT
             i.id,
             i.association_id,
             i.recipient_email,
             i.role_code,
             i.scope_type,
             i.branch_id,
             i.quranic_premise_id,
             i.circle_id,
             i.target_student_id,
             i.relationship_label,
             i.granted_permissions,
             i.status,
             i.expires_at,
             a.name AS association_name
           FROM public.invitations i
           INNER JOIN public.associations a ON a.id = i.association_id
           WHERE i.token_hash = $1
           FOR UPDATE OF i`,
          [tokenHash],
        );
        const invitation = invitationResult.rows[0];
        if (
          !invitation ||
          invitation.status !== "pending" ||
          new Date(invitation.expires_at).getTime() <= Date.now()
        ) {
          throw new BadRequestError("الدعوة غير صالحة أو انتهت صلاحيتها.", "INVALID_INVITATION");
        }

        const email = invitation.recipient_email.trim().toLowerCase();
        const existingAccount = await client.query<{ account_id: string }>(
          `SELECT ua.id AS account_id
           FROM public.persons p
           INNER JOIN public.user_accounts ua ON ua.person_id = p.id
           WHERE lower(btrim(p.email)) = $1
           LIMIT 1`,
          [email],
        );
        if (existingAccount.rows[0]) {
          throw new ConflictError(
            "هذا البريد لديه حساب بالفعل. سجّل الدخول بالحساب نفسه ثم اقبل الدعوة.",
            "INVITATION_ACCOUNT_EXISTS",
          );
        }

        let personId: string;
        let accountId: string;
        let fileNumber: string;
        const existingPerson = await client.query<{
          id: string;
          file_number: string;
          full_name: string;
        }>(
          `SELECT id, file_number, full_name
           FROM public.persons
           WHERE lower(btrim(email)) = $1 AND lifecycle_status = 'active'
           LIMIT 1
           FOR UPDATE`,
          [email],
        );

        if (existingPerson.rows[0]) {
          personId = existingPerson.rows[0].id;
          fileNumber = existingPerson.rows[0].file_number;
          await client.query(
            `UPDATE public.persons
             SET email_verified_at = COALESCE(email_verified_at, now()),
                 full_name = $2,
                 updated_at = now()
             WHERE id = $1`,
            [personId, body.fullName],
          );
        } else {
          personId = generateUuid();
          fileNumber = await reserveFileNumber(client, body.fullName);
          await client.query(
            `INSERT INTO public.persons (
               id, file_number, full_name, phone, email, email_verified_at
             )
             VALUES ($1, $2, $3, NULL, $4, now())`,
            [personId, fileNumber, body.fullName, email],
          );
        }

        accountId = generateUuid();
        await client.query(
          `INSERT INTO public.user_accounts (id, person_id, status, password_hash)
           VALUES ($1, $2, 'active', $3)`,
          [accountId, personId, passwordHash],
        );

        const membershipResult = await client.query<{ id: string }>(
          `SELECT id FROM public.association_memberships
           WHERE association_id = $1 AND person_id = $2
           LIMIT 1`,
          [invitation.association_id, personId],
        );
        const membershipId = membershipResult.rows[0]?.id ?? generateUuid();

        if (membershipResult.rows[0]) {
          await client.query(
            `UPDATE public.association_memberships
             SET status = 'active', valid_until = NULL, updated_at = now()
             WHERE id = $1`,
            [membershipId],
          );
        } else {
          await client.query(
            `INSERT INTO public.association_memberships (id, association_id, person_id, status)
             VALUES ($1, $2, $3, 'active')`,
            [membershipId, invitation.association_id, personId],
          );
        }

        const assignmentId = generateUuid();
        await client.query(
          `INSERT INTO public.role_assignments (
             id, association_id, membership_id, role_code, scope_type,
             branch_id, quranic_premise_id, circle_id, granted_permissions
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            assignmentId,
            invitation.association_id,
            membershipId,
            invitation.role_code,
            invitation.scope_type,
            invitation.branch_id,
            invitation.quranic_premise_id,
            invitation.circle_id,
            JSON.stringify(invitation.granted_permissions),
          ],
        );

        if (invitation.role_code === "guardian" && invitation.target_student_id) {
          await client.query(
            `INSERT INTO public.guardian_student_links (
               id, association_id, guardian_membership_id, student_id, relationship_label
             )
             VALUES ($1, $2, $3, $4, $5)`,
            [
              generateUuid(),
              invitation.association_id,
              membershipId,
              invitation.target_student_id,
              invitation.relationship_label ?? "ولي أمر",
            ],
          );
        }

        await client.query(
          `UPDATE public.invitations
           SET status = 'accepted',
               accepted_by_person_id = $2,
               accepted_at = now()
           WHERE id = $1 AND status = 'pending'`,
          [invitation.id, personId],
        );

        await recordAuditEvent(client, {
          associationId: invitation.association_id,
          actorPersonId: personId,
          actorMembershipId: membershipId,
          eventType: "invitation.accepted",
          entityType: "invitation",
          entityId: invitation.id,
          newData: {
            roleCode: invitation.role_code,
            scopeType: invitation.scope_type,
            createdAccount: true,
          },
        });

        return insertSession(client, request, {
          account_id: accountId,
          person_id: personId,
          full_name: body.fullName,
          file_number: fileNumber,
          platform_role: null,
        });
      });

      setSessionCookie(reply, session);
      return reply.status(201).send({
        message: "تم إنشاء حسابك وقبول الدعوة وإسناد الدور المحدد من الداعي.",
        user: {
          personId: session.account.person_id,
          accountId: session.account.account_id,
          fullName: session.account.full_name,
          fileNumber: session.account.file_number,
          platformRole: session.account.platform_role,
        },
      });
    },
  );
};

export default authAccountsRoutes;
