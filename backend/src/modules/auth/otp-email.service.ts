import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Delivers a backend-generated one-time login code through the existing
 * Rasikh EmailJS service/template. The OTP itself never comes from the browser.
 */
export async function sendLoginOtpEmail(
  recipientEmail: string,
  otpCode: string,
  idempotencyKey: string,
): Promise<void> {
  // Integration tests seed a known hash after requesting an OTP; never send test mail.
  if (env.NODE_ENV === "test") return;

  if (
    !env.EMAILJS_PUBLIC_KEY ||
    !env.EMAILJS_SERVICE_ID ||
    !env.EMAILJS_TEMPLATE_ID
  ) {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_NOT_CONFIGURED",
      "إعدادات إرسال البريد الإلكتروني غير مكتملة في الخادم. لم يتم إرسال رمز الدخول.",
    );
  }

  let response: Response;
  try {
    response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        service_id: env.EMAILJS_SERVICE_ID,
        template_id: env.EMAILJS_TEMPLATE_ID,
        user_id: env.EMAILJS_PUBLIC_KEY,
        template_params: {
          to_email: recipientEmail,
          user_name: "مستخدم نظام راسخ",
          otp_code: otpCode,
        },
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
    // Keep provider details out of the response shown to end users.
    throw new AppError(
      502,
      "EMAIL_DELIVERY_FAILED",
      `رفضت خدمة البريد إرسال رمز الدخول (رمز الاستجابة ${response.status}). تحقق من إعدادات EmailJS وحاول مرة أخرى.`,
    );
  }
}
