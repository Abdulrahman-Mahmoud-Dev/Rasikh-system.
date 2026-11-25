import { describe, expect, it } from "vitest";

import { evaluateStudentMonthlyProgress } from "../../src/shared/utilities/teacher-guide-evaluator.js";

describe("Teacher Guide Monthly Evaluator (Constitution 1.5 Section 7)", () => {
  it("computes ideal_student badge and exact 40/30/30 weighted score", () => {
    const result = evaluateStudentMonthlyProgress({
      targetMemorizationPages: 20,
      targetReviewPages: 400,
      studyDays: 20,
      attendanceEntries: Array.from({ length: 20 }, () => ({
        status: "present" as const,
      })),
      recitationEntries: [
        { track: "new_memorization", pagesCount: 20, rating: "excellent" },
        { track: "minor_review", pagesCount: 100, rating: "excellent" },
        { track: "major_review", pagesCount: 300, rating: "excellent" },
      ],
    });

    expect(result.memorizationScore).toBe(40);
    expect(result.reviewScore).toBe(30);
    expect(result.attendanceScore).toBe(30);
    expect(result.finalPercentage).toBe(100);
    expect(result.generalGrade).toBe("excellent");
    expect(result.monthlyBadge).toBe("ideal_student");
    expect(result.unrecordedDays).toBe(0);
  });

  it("applies quality multipliers (0.85, 0.70, 0.00) and never converts unrecorded days to absent", () => {
    const result = evaluateStudentMonthlyProgress({
      targetMemorizationPages: 20,
      targetReviewPages: 300,
      studyDays: 20,
      attendanceEntries: [
        ...Array.from({ length: 14 }, () => ({ status: "present" as const })),
        { status: "late" as const },
      ],
      recitationEntries: [
        { track: "new_memorization", pagesCount: 20, rating: "very_good" }, // 17.0
        { track: "minor_review", pagesCount: 100, rating: "good" }, // 70.0
        { track: "major_review", pagesCount: 230, rating: "excellent" }, // 230.0 -> total 300
        { track: "new_memorization", pagesCount: 10, rating: "retry" }, // 0.0
      ],
    });

    expect(result.attendedDays).toBe(15);
    expect(result.unrecordedDays).toBe(5);
    expect(result.adjustedMemorizationPages).toBe(17);
    expect(result.adjustedReviewPages).toBe(300);
    expect(result.memorizationScore).toBe(34); // (17/20)*40
    expect(result.reviewScore).toBe(30);
    expect(result.attendanceScore).toBe(22.5); // (15/20)*30
    expect(result.finalPercentage).toBe(86.5);
    expect(result.generalGrade).toBe("very_good");
    expect(result.monthlyBadge).toBe("regular_distinguished");
  });

  it("assigns diligent_achiever and high_very_good boundary accurately", () => {
    const result = evaluateStudentMonthlyProgress({
      targetMemorizationPages: 12,
      targetReviewPages: 200,
      studyDays: 20,
      attendanceEntries: Array.from({ length: 16 }, () => ({
        status: "present" as const,
      })),
      recitationEntries: [
        { track: "new_memorization", pagesCount: 12, rating: "excellent" },
        { track: "major_review", pagesCount: 200, rating: "excellent" },
      ],
    });

    expect(result.finalPercentage).toBe(94);
    expect(result.generalGrade).toBe("high_very_good");
    expect(result.monthlyBadge).toBe("diligent_achiever");
  });

  it("caps total score at 100 even if student exceeds plan targets", () => {
    const result = evaluateStudentMonthlyProgress({
      targetMemorizationPages: 10,
      targetReviewPages: 100,
      studyDays: 20,
      attendanceEntries: Array.from({ length: 20 }, () => ({
        status: "present" as const,
      })),
      recitationEntries: [
        { track: "new_memorization", pagesCount: 25, rating: "excellent" },
        { track: "major_review", pagesCount: 400, rating: "excellent" },
      ],
    });

    expect(result.finalPercentage).toBe(100);
    expect(result.generalGrade).toBe("excellent");
    expect(result.monthlyBadge).toBe("ideal_student");
  });

  it("rejects custom weights that do not sum to 100", () => {
    expect(() =>
      evaluateStudentMonthlyProgress({
        weights: {
          memorizationWeight: 50,
          reviewWeight: 30,
          attendanceWeight: 30,
        },
        targetMemorizationPages: 10,
        targetReviewPages: 100,
        studyDays: 20,
        attendanceEntries: [],
        recitationEntries: [],
      }),
    ).toThrow(/100/);
  });
});
