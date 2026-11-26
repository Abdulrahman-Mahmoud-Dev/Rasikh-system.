import { env } from "../../config/env.js";
import { ServiceUnavailableError } from "../../shared/errors/app-error.js";

export async function sendLoginOtpEmail(
  recipientEmail: string,
  otpCode: string,
  idempotencyKey: string,
): Promise<void> {
  // Integration tests seed a known hash directly and must not send external email.
  if (env.NODE_ENV === "test") {
    return;
  }

  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) {
    throw new ServiceUnavailableError(
      "إرسال رمز الدخول بالبريد غير مفعّل بعد. يلزم إعداد RESEND_API_KEY وAUTH_EMAIL_FROM على خادم راسخ.",
      "EMAIL_DELIVERY_NOT_CONFIGURED",
    );
  }

  const plainText = [
    "مرحبًا بك في نظام راسخ.",
    "",
    `رمز التحقق الخاص بك هو: ${otpCode}`,
    "",
    "الرمز صالح لمدة ٥ دقائق.",
    "لا تشارك هذا الرمز مع أي شخص.",
    "إذا لم تطلب تسجيل الدخول، فتجاهل هذه الرسالة.",
  ].join("\n");

  const html = [
    '<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.9;color:#182A27">',
    "<p>مرحبًا بك في <strong>نظام راسخ</strong>.</p>",
    "<p>رمز التحقق الخاص بك:</p>",
    '<p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#0B1F3F">',
    otpCode,
    "</p>",
    "<p>الرمز صالح لمدة ٥ دقائق. لا تشاركه مع أي شخص.</p>",
    "<p>إذا لم تطلب تسجيل الدخول، فتجاهل هذه الرسالة.</p>",
    "</div>",
  ].join("");

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: env.AUTH_EMAIL_FROM,
        to: [recipientEmail],
        subject: "رمز الدخول إلى نظام راسخ",
        text: plainText,
        html,
      }),
    });
  } catch {
    throw new ServiceUnavailableError(
      "تعذر الاتصال بخدمة البريد لإرسال رمز الدخول. حاول مرة أخرى لاحقًا.",
      "EMAIL_PROVIDER_UNAVAILABLE",
    );
  }

  if (!response.ok) {
    // Do not expose provider response details or credentials to the caller.
    throw new ServiceUnavailableError(
      "لم تتمكن خدمة البريد من قبول رسالة التحقق. تحقق من إعداد المرسل ونطاق البريد ثم حاول مجددًا.",
      "EMAIL_DELIVERY_FAILED",
    );
  }
}
