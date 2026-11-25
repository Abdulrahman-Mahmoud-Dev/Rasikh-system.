const ARABIC_INDIC_ZERO = 0x0660;
const EASTERN_ARABIC_ZERO = 0x06f0;
const TASHKEEL_AND_TATWEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/**
 * Converts Arabic-Indic (٠-٩) and Eastern Arabic (۰-۹) digits to ASCII (0-9).
 */
export function normalizeDigits(input: string): string {
  return input.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (char) => {
    const code = char.charCodeAt(0);
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      return String(code - ARABIC_INDIC_ZERO);
    }
    return String(code - EASTERN_ARABIC_ZERO);
  });
}

/**
 * Strips diacritics (tashkeel), normalizes digits, and collapses whitespace
 * for safe Arabic partial search without conflating distinct names.
 */
export function normalizeArabicForSearch(input: string): string {
  return normalizeDigits(input)
    .replace(TASHKEEL_AND_TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Validates and normalizes Saudi mobile numbers to canonical 05xxxxxxxx format.
 * Returns null if the number is not a valid Saudi mobile number.
 */
export function normalizeSaudiPhone(input: string): string | null {
  const ascii = normalizeDigits(input).replace(/[\s\-()]/g, "");
  let candidate = ascii;

  if (candidate.startsWith("+966")) {
    candidate = "0" + candidate.slice(4);
  } else if (candidate.startsWith("00966")) {
    candidate = "0" + candidate.slice(5);
  } else if (candidate.startsWith("966") && candidate.length === 12) {
    candidate = "0" + candidate.slice(3);
  }

  return /^05\d{8}$/.test(candidate) ? candidate : null;
}
