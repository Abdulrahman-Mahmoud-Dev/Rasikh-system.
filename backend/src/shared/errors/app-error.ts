export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(
    message: string = "الطلب غير صالح أو يحتوي على بيانات ناقصة.",
    code: string = "BAD_REQUEST",
    details?: unknown,
  ) {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message: string = "يرجى تسجيل الدخول للمتابعة.",
    code: string = "UNAUTHORIZED",
  ) {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message: string = "ليست لديك صلاحية لتنفيذ هذا الإجراء.",
    code: string = "FORBIDDEN",
  ) {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(
    message: string = "العنصر المطلوب غير موجود.",
    code: string = "NOT_FOUND",
  ) {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(
    message: string = "توجد عملية أو سجل متعارض مع هذا الإجراء.",
    code: string = "CONFLICT",
    details?: unknown,
  ) {
    super(409, code, message, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(
    message: string = "تم تجاوز الحد المسموح من المحاولات. يرجى المحاولة لاحقًا.",
    code: string = "TOO_MANY_REQUESTS",
  ) {
    super(429, code, message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message: string = "الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا.",
    code: string = "SERVICE_UNAVAILABLE",
  ) {
    super(503, code, message);
  }
}
