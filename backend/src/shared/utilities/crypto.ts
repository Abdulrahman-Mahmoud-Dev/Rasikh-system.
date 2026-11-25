import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const ARABIC_TO_LATIN_PREFIX: Record<string, string> = {
  ا: "A",
  أ: "A",
  إ: "A",
  آ: "A",
  ب: "B",
  ت: "T",
  ث: "T",
  ج: "J",
  ح: "H",
  خ: "K",
  د: "D",
  ذ: "D",
  ر: "R",
  ز: "Z",
  س: "S",
  ش: "S",
  ص: "S",
  ض: "D",
  ط: "T",
  ظ: "Z",
  ع: "A",
  غ: "G",
  ف: "F",
  ق: "Q",
  ك: "K",
  ل: "L",
  م: "M",
  ن: "N",
  ه: "H",
  ة: "H",
  و: "W",
  ي: "Y",
  ى: "Y",
};

export function generateUuid(): string {
  return randomUUID();
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashSecret(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function generateOtpCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Derives a unique person file number formatted as AAA-123456 (Constitution 1.5 Section 4.1).
 */
export function generateFileNumber(fullName: string): string {
  const letters: string[] = [];
  for (const ch of fullName.trim()) {
    if (letters.length >= 3) break;
    if (/^[A-Za-z]$/.test(ch)) {
      letters.push(ch.toUpperCase());
      continue;
    }
    const mapped = ARABIC_TO_LATIN_PREFIX[ch];
    if (mapped) {
      letters.push(mapped);
    }
  }

  while (letters.length < 3) {
    letters.push(String.fromCharCode(randomInt(65, 91)));
  }

  const prefix = letters.slice(0, 3).join("");
  const digits = String(randomInt(100_000, 1_000_000));
  return `${prefix}-${digits}`;
}
