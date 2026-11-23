import {
  QUALITY_MULTIPLIERS,
  type AttendanceStatus,
  type DailyRating,
  type RecitationTrack,
} from "../domain/constants.js";
import { BadRequestError } from "../errors/app-error.js";

export type GeneralGrade =
  | "excellent"
  | "high_very_good"
  | "very_good"
  | "acceptable_retry";

export type MonthlyBadge =
  | "ideal_student"
  | "regular_distinguished"
  | "diligent_achiever"
  | "needs_regularity";

export interface EvaluationWeights {
  memorizationWeight: number;
  reviewWeight: number;
  attendanceWeight: number;
}

export interface RecitationEntry {
  track: RecitationTrack;
  pagesCount: number;
  rating: DailyRating;
}

export interface AttendanceEntry {
  status: AttendanceStatus;
}

export interface MonthlyEvaluationInput {
  weights?: EvaluationWeights;
  multipliers?: Partial<Record<DailyRating, number>>;
  targetMemorizationPages: number;
  targetReviewPages: number;
  studyDays: number;
  attendanceEntries: readonly AttendanceEntry[];
  recitationEntries: readonly RecitationEntry[];
}

export interface MonthlyEvaluationResult {
  attendedDays: number;
  studyDays: number;
  unrecordedDays: number;
  rawMemorizationPages: number;
  rawReviewPages: number;
  adjustedMemorizationPages: number;
  adjustedReviewPages: number;
  memorizationScore: number;
  reviewScore: number;
  attendanceScore: number;
  finalPercentage: number;
  generalGrade: GeneralGrade;
  monthlyBadge: MonthlyBadge;
}

const DEFAULT_WEIGHTS: EvaluationWeights = {
  memorizationWeight: 40,
  reviewWeight: 30,
  attendanceWeight: 30,
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Computes monthly student progress, grade, and badge according to
 * Rasikh Constitution 1.5 Sections 7.2 - 7.6 (Teacher Guide Standard).
 *
 * Unrecorded study days are tracked explicitly in `unrecordedDays` and are
 * NEVER converted into synthetic absences or zero scores.
 */
export function evaluateStudentMonthlyProgress(
  input: MonthlyEvaluationInput,
): MonthlyEvaluationResult {
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const totalWeight = round2(
    weights.memorizationWeight +
      weights.reviewWeight +
      weights.attendanceWeight,
  );

  if (Math.abs(totalWeight - 100) > 0.01) {
    throw new BadRequestError(
      "يجب أن يساوي مجموع أوزان التقييم 100% تمامًا.",
      "INVALID_EVALUATION_WEIGHTS",
    );
  }

  if (input.studyDays <= 0) {
    throw new BadRequestError(
      "عدد أيام الدراسة يجب أن يكون أكبر من صفر.",
      "INVALID_STUDY_DAYS",
    );
  }

  const multipliers: Record<DailyRating, number> = {
    ...QUALITY_MULTIPLIERS,
    ...input.multipliers,
  };

  let rawMem = 0;
  let rawRev = 0;
  let adjustedMem = 0;
  let adjustedRev = 0;

  for (const entry of input.recitationEntries) {
    const pages = Math.max(0, entry.pagesCount);
    const factor = multipliers[entry.rating] ?? 0;

    if (entry.track === "new_memorization") {
      rawMem += pages;
      adjustedMem += pages * factor;
    } else {
      rawRev += pages;
      adjustedRev += pages * factor;
    }
  }

  let attendedDays = 0;
  for (const record of input.attendanceEntries) {
    if (record.status === "present" || record.status === "late") {
      attendedDays += 1;
    }
  }

  const unrecordedDays = Math.max(
    0,
    input.studyDays - input.attendanceEntries.length,
  );

  const memRatio =
    input.targetMemorizationPages > 0
      ? Math.min(1, adjustedMem / input.targetMemorizationPages)
      : 0;
  const revRatio =
    input.targetReviewPages > 0
      ? Math.min(1, adjustedRev / input.targetReviewPages)
      : 0;
  const attRatio = Math.min(1, attendedDays / input.studyDays);

  const memorizationScore = round2(memRatio * weights.memorizationWeight);
  const reviewScore = round2(revRatio * weights.reviewWeight);
  const attendanceScore = round2(attRatio * weights.attendanceWeight);

  const finalPercentage = Math.min(
    100,
    round2(memorizationScore + reviewScore + attendanceScore),
  );

  let generalGrade: GeneralGrade;
  if (finalPercentage >= 95) {
    generalGrade = "excellent";
  } else if (finalPercentage >= 90) {
    generalGrade = "high_very_good";
  } else if (finalPercentage >= 80) {
    generalGrade = "very_good";
  } else {
    generalGrade = "acceptable_retry";
  }

  const roundedAdjMem = round2(adjustedMem);
  const roundedAdjRev = round2(adjustedRev);

  let monthlyBadge: MonthlyBadge = "needs_regularity";
  if (
    (generalGrade === "excellent" || generalGrade === "high_very_good") &&
    attendedDays >= 18 &&
    roundedAdjMem >= 20 &&
    roundedAdjRev >= 400
  ) {
    monthlyBadge = "ideal_student";
  } else if (
    (generalGrade === "excellent" ||
      generalGrade === "high_very_good" ||
      generalGrade === "very_good") &&
    attendedDays >= 15 &&
    roundedAdjMem >= 15 &&
    roundedAdjRev >= 300
  ) {
    monthlyBadge = "regular_distinguished";
  } else if (
    generalGrade !== "acceptable_retry" &&
    attendedDays >= 12 &&
    roundedAdjMem >= 10 &&
    roundedAdjRev >= 200
  ) {
    monthlyBadge = "diligent_achiever";
  }

  return {
    attendedDays,
    studyDays: input.studyDays,
    unrecordedDays,
    rawMemorizationPages: round2(rawMem),
    rawReviewPages: round2(rawRev),
    adjustedMemorizationPages: roundedAdjMem,
    adjustedReviewPages: roundedAdjRev,
    memorizationScore,
    reviewScore,
    attendanceScore,
    finalPercentage,
    generalGrade,
    monthlyBadge,
  };
}
