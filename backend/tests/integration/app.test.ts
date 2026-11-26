import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { ROLE_DEFAULT_PERMISSIONS } from "../../src/shared/domain/constants.js";
import { hashSecret } from "../../src/shared/utilities/crypto.js";

const ASSOC_A = "11111111-1111-4111-8111-111111111111";
const ASSOC_OTHER = "99999999-9999-4999-8999-999999999999";
const PERSON_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBERSHIP_GUARDIAN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STUDENT_CHILD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    rows,
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
  };
}

function createMockPool(options?: { failSelectOne?: boolean }) {
  const challenges: Array<{
    id: string;
    identifier_type: string;
    identifier_value: string;
    otp_hash: string;
    attempt_count: number;
    max_attempts: number;
    expires_at: string;
    consumed_at: string | null;
  }> = [];

  const sessions: Array<{
    id: string;
    account_id: string;
    person_id: string;
    token_hash: string;
    expires_at: string;
    revoked_at: string | null;
  }> = [];

  const queryHandler = async <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> => {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
      return makeResult<T>([]);
    }

    if (normalized === "SELECT 1") {
      if (options?.failSelectOne) {
        throw new Error("Simulated DB offline");
      }
      return makeResult<T>([{ "?column?": 1 } as unknown as T]);
    }

    if (normalized.includes("SELECT EXISTS") && normalized.includes("FROM public.persons p")) {
      return makeResult<T>([{ account_exists: true } as unknown as T]);
    }

    if (normalized.startsWith("INSERT INTO public.login_challenges")) {
      challenges.push({
        id: String(values[0]),
        identifier_type: String(values[1]),
        identifier_value: String(values[2]),
        otp_hash: String(values[4]),
        attempt_count: 0,
        max_attempts: Number(values[5]),
        expires_at: String(values[6]),
        consumed_at: null,
      });
      return makeResult<T>([]);
    }

    if (normalized.includes("FROM public.login_challenges")) {
      const idType = String(values[0]);
      const idVal = String(values[1]);
      const match = [...challenges]
        .reverse()
        .find(
          (c) => c.identifier_type === idType && c.identifier_value === idVal,
        );
      return makeResult<T>(match ? [match as unknown as T] : []);
    }

    if (normalized.startsWith("UPDATE public.login_challenges SET attempt_count")) {
      const challenge = challenges.find((c) => c.id === String(values[0]));
      if (challenge) challenge.attempt_count += 1;
      return makeResult<T>([]);
    }

    if (normalized.startsWith("UPDATE public.login_challenges SET consumed_at")) {
      const challenge = challenges.find((c) => c.id === String(values[0]));
      if (challenge) challenge.consumed_at = new Date().toISOString();
      return makeResult<T>([]);
    }

    if (
      normalized.includes("FROM public.persons p") &&
      normalized.includes("INNER JOIN public.user_accounts ua")
    ) {
      if (String(values[0]) === "guardian@rasikh.example") {
        return makeResult<T>([
          {
            account_id: ACCOUNT_ID,
            person_id: PERSON_ID,
            full_name: "أحمد محمد",
            file_number: "AHM-123456",
            account_status: "active",
            platform_role: null,
          } as unknown as T,
        ]);
      }
      return makeResult<T>([]);
    }

    if (normalized.startsWith("INSERT INTO public.auth_sessions")) {
      sessions.push({
        id: String(values[0]),
        account_id: String(values[1]),
        person_id: String(values[2]),
        token_hash: String(values[3]),
        expires_at: String(values[5]),
        revoked_at: null,
      });
      return makeResult<T>([]);
    }

    if (normalized.startsWith("INSERT INTO public.audit_events")) {
      return makeResult<T>([]);
    }

    if (normalized.includes("FROM public.auth_sessions s")) {
      const tokenHash = String(values[0]);
      const session = sessions.find(
        (s) => s.token_hash === tokenHash && s.revoked_at === null,
      );
      if (!session) return makeResult<T>([]);
      return makeResult<T>([
        {
          session_id: session.id,
          account_id: session.account_id,
          person_id: session.person_id,
          full_name: "أحمد محمد",
          file_number: "AHM-123456",
          platform_role: null,
        } as unknown as T,
      ]);
    }

    if (normalized.includes("FROM public.association_memberships m INNER JOIN public.role_assignments ra")) {
      const personId = String(values[0]);
      const associationId = String(values[1]);
      if (personId === PERSON_ID && associationId === ASSOC_A) {
        return makeResult<T>([
          {
            membership_id: MEMBERSHIP_GUARDIAN_ID,
            assignment_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            role_code: "guardian",
            scope_type: "guardian_children",
            branch_id: null,
            quranic_premise_id: null,
            circle_id: null,
            granted_permissions: [...ROLE_DEFAULT_PERMISSIONS.guardian],
          } as unknown as T,
        ]);
      }
      return makeResult<T>([]);
    }

    if (normalized.includes("FROM public.association_evaluation_settings")) {
      return makeResult<T>([]);
    }

    if (
      normalized.includes("FROM public.circles c") &&
      normalized.includes("INNER JOIN public.quranic_premises qp")
    ) {
      return makeResult<T>([
        {
          circle_id: "66666666-6666-4666-8666-666666666666",
          quranic_premise_id: "55555555-5555-4555-8555-555555555555",
          branch_id: "33333333-3333-4333-8333-333333333333",
          operational_status: "active",
        } as unknown as T,
      ]);
    }

    if (normalized.includes("FROM public.students s INNER JOIN public.persons p")) {
      return makeResult<T>([
        {
          student_id: STUDENT_CHILD_ID,
          full_name: "عبدالله أحمد",
          file_number: "ABD-654321",
          circle_name: "حلقة أبي بكر الصديق",
          target_memorization_pages: 20,
          target_review_pages: 400,
          target_study_days: 20,
        } as unknown as T,
      ]);
    }

    if (normalized.includes("FROM public.daily_attendance_records")) {
      return makeResult<T>(
        Array.from({ length: 18 }, () => ({
          student_id: STUDENT_CHILD_ID,
          status: "present",
        })) as unknown as T[],
      );
    }

    if (normalized.includes("FROM public.daily_recitation_records")) {
      return makeResult<T>([
        {
          student_id: STUDENT_CHILD_ID,
          track: "new_memorization",
          pages_count: 20,
          daily_rating: "excellent",
        },
        {
          student_id: STUDENT_CHILD_ID,
          track: "major_review",
          pages_count: 400,
          daily_rating: "excellent",
        },
      ] as unknown as T[]);
    }

    return makeResult<T>([]);
  };

  const mockClient = {
    query: queryHandler,
    release: () => {},
  } as unknown as PoolClient;

  const mockPool = {
    query: queryHandler,
    connect: async () => mockClient,
    end: async () => {},
  } as unknown as Pool;

  return { mockPool, challenges };
}

describe("Fastify Backend HTTP Integration", () => {
  const { mockPool, challenges } = createMockPool();
  const app = buildApp({ pool: mockPool, logger: false });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 on /health and /health/ready", async () => {
    const healthRes = await app.inject({ method: "GET", url: "/health" });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json()).toMatchObject({
      status: "ok",
      service: "rasikh-backend",
    });

    const readyRes = await app.inject({ method: "GET", url: "/health/ready" });
    expect(readyRes.statusCode).toBe(200);
    expect(readyRes.json()).toEqual({
      status: "ready",
      database: "connected",
    });
  });

  it("returns 503 on /health/ready when database query fails", async () => {
    const { mockPool: brokenPool } = createMockPool({ failSelectOne: true });
    const brokenApp = buildApp({ pool: brokenPool, logger: false });
    await brokenApp.ready();

    const res = await brokenApp.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: "not_ready",
      database: "unavailable",
    });

    await brokenApp.close();
  });

  it("blocks unauthenticated requests with 401 and unknown routes with 404", async () => {
    const notFoundRes = await app.inject({
      method: "GET",
      url: "/api/v1/nonexistent",
    });
    expect(notFoundRes.statusCode).toBe(404);

    const meRes = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
    });
    expect(meRes.statusCode).toBe(401);
  });

  it("completes server-side OTP login, blocks cross-tenant access, enforces guardian read-only, and computes monthly report", async () => {
    // 1. Request OTP — response never returns OTP code
    const otpReqRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp/request",
      payload: {
        email: "guardian@rasikh.example",
      },
    });
    expect(otpReqRes.statusCode).toBe(200);
    expect(JSON.stringify(otpReqRes.json())).not.toContain("otp");

    // Seed known OTP hash onto latest challenge to simulate reading email
    const latestChallenge = challenges[challenges.length - 1];
    expect(latestChallenge).toBeDefined();
    if (latestChallenge) {
      latestChallenge.otp_hash = hashSecret("482913", env.COOKIE_SECRET);
    }

    // 2. Wrong OTP fails with 401
    const wrongVerifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp/verify",
      payload: {
        email: "guardian@rasikh.example",
        code: "000000",
      },
    });
    expect(wrongVerifyRes.statusCode).toBe(401);

    // 3. Correct OTP succeeds and sets signed HttpOnly cookie
    const okVerifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp/verify",
      payload: {
        identifierType: "email",
        identifier: "guardian@rasikh.example",
        code: "482913",
      },
    });
    expect(okVerifyRes.statusCode).toBe(200);
    const setCookieHeader = okVerifyRes.headers["set-cookie"];
    expect(setCookieHeader).toBeDefined();
    const cookiePair = Array.isArray(setCookieHeader)
      ? setCookieHeader[0]?.split(";")[0]
      : String(setCookieHeader).split(";")[0];
    expect(cookiePair).toContain("rasikh_session=");

    // 4. Cross-tenant access to ASSOC_OTHER is rejected with 403
    const crossTenantRes = await app.inject({
      method: "GET",
      url: `/api/v1/associations/${ASSOC_OTHER}/students`,
      headers: { cookie: cookiePair },
    });
    expect(crossTenantRes.statusCode).toBe(403);

    // 5. Guardian cannot create students (read-only role enforced on server)
    const guardianCreateRes = await app.inject({
      method: "POST",
      url: `/api/v1/associations/${ASSOC_A}/students`,
      headers: { cookie: cookiePair },
      payload: {
        circleId: "66666666-6666-4666-8666-666666666666",
        fullName: "طالب تجريبي",
        phone: "0501112233",
        email: "student@rasikh.example",
      },
    });
    expect(guardianCreateRes.statusCode).toBe(403);

    // 6. Guardian can read monthly Teacher Guide report for linked child
    const reportRes = await app.inject({
      method: "GET",
      url: `/api/v1/associations/${ASSOC_A}/reports/monthly?hijriPeriodKey=1448_محرم`,
      headers: { cookie: cookiePair },
    });
    expect(reportRes.statusCode).toBe(200);
    const reportJson = reportRes.json();
    expect(reportJson.students).toHaveLength(1);
    expect(reportJson.students[0]).toMatchObject({
      studentId: STUDENT_CHILD_ID,
      finalPercentage: 97,
      generalGrade: "excellent",
      monthlyBadge: "ideal_student",
    });
  });
});
