import {
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";

import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

interface GoogleSigningKey {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

interface GoogleTokenHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface GoogleTokenClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  hd?: string;
  nonce?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
}

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  name: string;
  picture: string | null;
  emailAuthoritative: boolean;
}

let cachedKeys: GoogleSigningKey[] = [];
let keysExpireAt = 0;

async function loadGoogleSigningKeys(): Promise<GoogleSigningKey[]> {
  if (cachedKeys.length > 0 && Date.now() < keysExpireAt) {
    return cachedKeys;
  }

  let response: Response;
  try {
    response = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new AppError(
      503,
      "GOOGLE_VERIFICATION_UNAVAILABLE",
      "تعذر الاتصال بخدمة التحقق من Google. حاول مرة أخرى.",
    );
  }

  if (!response.ok) {
    throw new AppError(
      503,
      "GOOGLE_VERIFICATION_UNAVAILABLE",
      "تعذر جلب مفاتيح التحقق من Google.",
    );
  }

  const body = (await response.json()) as { keys?: GoogleSigningKey[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new AppError(
      503,
      "GOOGLE_KEYS_INVALID",
      "لم تُرجع Google مفاتيح تحقق صالحة.",
    );
  }

  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 3600);
  cachedKeys = body.keys;
  keysExpireAt = Date.now() + Math.min(Math.max(maxAge, 60), 86_400) * 1000;
  return cachedKeys;
}

function decodePart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<VerifiedGoogleIdentity> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError(
      503,
      "GOOGLE_SIGN_IN_NOT_CONFIGURED",
      "تسجيل الدخول باستخدام Google يحتاج إلى إعداد Client ID في الخادم.",
    );
  }

  const tokenParts = idToken.split(".");
  if (tokenParts.length !== 3) {
    throw new AppError(401, "GOOGLE_TOKEN_INVALID", "رمز Google غير صالح.");
  }

  let header: GoogleTokenHeader;
  let claims: GoogleTokenClaims;
  try {
    header = decodePart<GoogleTokenHeader>(tokenParts[0] ?? "");
    claims = decodePart<GoogleTokenClaims>(tokenParts[1] ?? "");
  } catch {
    throw new AppError(401, "GOOGLE_TOKEN_INVALID", "تعذر قراءة رمز Google.");
  }

  if (header.alg !== "RS256" || !header.kid) {
    throw new AppError(401, "GOOGLE_TOKEN_INVALID", "توقيع رمز Google غير مدعوم.");
  }

  const keys = await loadGoogleSigningKeys();
  let jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) {
    cachedKeys = [];
    const refreshedKeys = await loadGoogleSigningKeys();
    jwk = refreshedKeys.find(
      (key) => key.kid === header.kid && key.kty === "RSA",
    );
  }
  if (!jwk) {
    throw new AppError(401, "GOOGLE_SIGNING_KEY_UNKNOWN", "مفتاح توقيع Google غير معروف.");
  }

  const publicKey = createPublicKey({
    key: jwk as import("node:crypto").JsonWebKey,
    format: "jwk",
  });
  const signedContent = Buffer.from(
    `${tokenParts[0]}.${tokenParts[1]}`,
    "utf8",
  );
  const signature = Buffer.from(tokenParts[2] ?? "", "base64url");
  const signatureValid = verifySignature(
    "RSA-SHA256",
    signedContent,
    publicKey,
    signature,
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const audienceMatches = Array.isArray(claims.aud)
    ? claims.aud.includes(env.GOOGLE_CLIENT_ID)
    : claims.aud === env.GOOGLE_CLIENT_ID;

  if (
    !signatureValid ||
    (claims.iss !== "https://accounts.google.com" &&
      claims.iss !== "accounts.google.com") ||
    !audienceMatches ||
    !claims.sub ||
    !claims.exp ||
    claims.exp <= nowSeconds ||
    (claims.iat !== undefined && claims.iat > nowSeconds + 300) ||
    (claims.nbf !== undefined && claims.nbf > nowSeconds + 60) ||
    claims.nonce !== expectedNonce ||
    !claims.email ||
    !(claims.email_verified === true || claims.email_verified === "true")
  ) {
    throw new AppError(
      401,
      "GOOGLE_TOKEN_INVALID",
      "تعذر التحقق من حساب Google أو انتهت صلاحية عملية الدخول.",
    );
  }

  const email = claims.email.trim().toLowerCase();
  const emailVerified =
    claims.email_verified === true || claims.email_verified === "true";
  const emailAuthoritative =
    email.endsWith("@gmail.com") || (emailVerified && Boolean(claims.hd));

  return {
    subject: claims.sub,
    email,
    name: claims.name?.trim() || email.split("@")[0] || "مستخدم راسخ",
    picture: claims.picture ?? null,
    emailAuthoritative,
  };
}
