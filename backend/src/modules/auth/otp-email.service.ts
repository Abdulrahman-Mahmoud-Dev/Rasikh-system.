import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Sends a one-time login code through Resend.
 * The API key and verified sender stay in backend environment secrets.
 */
export async function sendLoginOtpEmail(
  recipientEmail: string,
  otpCode: string,
  idempotencyKey: string,
): Promise<void> {
  // Integration tests seed a known hash after requesting an OTP; never send test mail.
  if (env.NODE_ENV === "test") return;

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_NOT_CONFIGURED",
      "خدمة إرسال البريد الإلكتروني غير مهيأة في الخادم بعد. لم يتم إرسال رمز الدخول.",
    );
  }

  const subject = "رمز الدخول إلى نظام راسخ";
  const text = [
    "السلام عليكم ورحمة الله وبركاته،",
    "",
    "رمز التحقق للدخول إلى نظام راسخ هو:",
    otpCode,
    "",
    "تنتهي صلاحية الرمز خلال ٥ دقائق. لا تشاركه مع أي شخص.",
    "إذا لم تطلب تسجيل الدخول، فتجاهل هذه الرسالة.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<body style="margin:0;padding:24px;background:#F4F6F9;font-family:Arial,Tahoma,sans-serif;color:#172A25">
  <main style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:28px">
    <h1 style="margin:0 0 8px;color:#0B1F3F;font-size:25px">نظام راسخ</h1>
    <p style="margin:0 0 24px;color:#64748B">رمز التحقق لتسجيل الدخول</p>
    <p>السلام عليكم ورحمة الله وبركاته،</p>
    <p>استخدم الرمز التالي لإكمال تسجيل الدخول:</p>
    <div dir="ltr" style="margin:24px 0;padding:18px;text-align:center;background:#F4F6F9;border:1px solid #D2A24F;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:8px;color:#0B1F3F">${otpCode}</div>
    <p style="color:#64748B">تنتهي صلاحية الرمز خلال ٥ دقائق. لا تشاركه مع أي شخص.</p>
    <hr style="border:0;border-top:1px solid #E2E8F0;margin:24px 0">
    <p style="margin:0;color:#8493A8;font-size:12px">إذا لم تطلب تسجيل الدخول، فتجاهل هذه الرسالة.</p>
  </main>
</body>
</html>`;

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `rasikh-login-otp/${idempotencyKey}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [recipientEmail],
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(
      503,
      "EMAIL_PROVIDER_UNAVAILABLE",
      "تعذر الاتصال بخدمة البريد الإلكتروني. لم يتم إرسال رمز الدخول، حاول مرة أخرى.",
    );
  }

  if (!response.ok) {
    throw new AppError(
      502,
      "EMAIL_DELIVERY_FAILED",
      "تعذر إرسال رسالة التحقق إلى بريدك الإلكتروني. تحقق من إعدادات البريد وحاول مرة أخرى.",
    );
  }
}
