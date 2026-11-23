import { describe, expect, it } from "vitest";

import { SURAHS_114 } from "../../src/shared/domain/constants.js";
import {
  normalizeArabicForSearch,
  normalizeDigits,
  normalizeSaudiPhone,
} from "../../src/shared/utilities/arabic.js";
import {
  generateFileNumber,
  generateOtpCode,
  hashSecret,
  timingSafeHexEqual,
} from "../../src/shared/utilities/crypto.js";

describe("Arabic Utilities, Crypto & Constants (Constitution 1.5)", () => {
  it("normalizes Arabic-Indic and Eastern Arabic digits to ASCII", () => {
    expect(normalizeDigits("٠٥٥١٢٣٤٥٦٧")).toBe("0551234567");
    expect(normalizeDigits("۰۵۵۱۲۳۴۵۶۷")).toBe("0551234567");
  });

  it("normalizes Arabic search queries while stripping tashkeel", () => {
    expect(normalizeArabicForSearch("  أَحْمَدُ   إِبْرَاهِيم  ")).toBe(
      "احمد ابراهيم",
    );
  });

  it("validates and normalizes Saudi mobile numbers", () => {
    expect(normalizeSaudiPhone("٠٥٠١٢٣٤٥٦٧")).toBe("0501234567");
    expect(normalizeSaudiPhone("+966 55 123 4567")).toBe("0551234567");
    expect(normalizeSaudiPhone("966501234567")).toBe("0501234567");
    expect(normalizeSaudiPhone("0412345678")).toBeNull();
    expect(normalizeSaudiPhone("12345")).toBeNull();
  });

  it("generates file numbers matching AAA-123456 format and valid 6-digit OTPs", () => {
    expect(generateFileNumber("كريم محمد")).toMatch(/^[A-Z]{3}-\d{6}$/);
    expect(generateFileNumber("Abdullah")).toMatch(/^[A-Z]{3}-\d{6}$/);
    expect(generateOtpCode()).toMatch(/^\d{6}$/);

    const h1 = hashSecret("123456", "test_secret_minimum_32_characters_here");
    const h2 = hashSecret("123456", "test_secret_minimum_32_characters_here");
    const h3 = hashSecret("654321", "test_secret_minimum_32_characters_here");
    expect(timingSafeHexEqual(h1, h2)).toBe(true);
    expect(timingSafeHexEqual(h1, h3)).toBe(false);
  });

  it("contains all 114 Surahs with tashkeel", () => {
    expect(SURAHS_114).toHaveLength(114);
    expect(SURAHS_114[0]).toBe("الفَاتِحَة");
    expect(SURAHS_114[113]).toBe("النَّاس");
  });
});
