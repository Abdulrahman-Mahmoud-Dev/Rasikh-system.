import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

type EmailTemplateParams = Record<string, string>;

let emailQueue: Promise<void> = Promise.resolve();
let nextEmailDispatchAt = 0;

async function enqueueEmail(task: () => Promise<void>): Promise<void> {
  const current = emailQueue.then(async () => {
    const waitMs = Math.max(0, nextEmailDispatchAt - Date.now());
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    nextEmailDispatchAt = Date.now() + 1_000;
    await task();
  });
  emailQueue = current.catch(() => undefined);
  return current;
}

async function sendEmailTemplate(
  recipientEmail: string,
  templateId: string | undefined,
  params: EmailTemplateParams,
): Promise<void> {
  if (env.NODE_ENV === "test") return;

  if (!env.EMAILJS_PUBLIC_KEY || !env.EMAILJS_SERVICE_ID || !templateId) {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_NOT_CONFIGURED",
      "إعدادات خدمة البريد أو قالب الرسالة غير مكتملة في الخادم.",
    );
  }

  await enqueueEmail(async () => {
  const payload: Record<string, unknown> = {
    service_id: env.EMAILJS_SERVICE_ID,
    template_id: templateId,
    user_id: env.EMAILJS_PUBLIC_KEY,
    template_params: {
      to_email: recipientEmail,
      ...params,
    },
  };

  // Keep the EmailJS private key in the backend secret store only.
  if (env.EMAILJS_PRIVATE_KEY) {
    payload.accessToken = env.EMAILJS_PRIVATE_KEY;
  }

  let response: Response;
  try {
    response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AppError(
      503,
      "EMAIL_PROVIDER_UNAVAILABLE",
      "تعذر الاتصال بخدمة البريد الإلكتروني. لم يتم إرسال الرسالة.",
    );
  }

  if (!response.ok) {
    throw new AppError(
      502,
      "EMAIL_DELIVERY_FAILED",
      "رفضت خدمة البريد إرسال الرسالة. راجع إعدادات القالب والمستلم في EmailJS.",
    );
  }
  });
}

export interface InvitationEmail {
  recipientEmail: string;
  recipientName: string;
  invitationUrl: string;
  organizationName: string;
  roleName: string;
  scopeName: string;
  expiresAt: Date;
  inviterName: string;
}

export async function sendInvitationEmail(
  invitation: InvitationEmail,
): Promise<void> {
  const expiresAt = new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(invitation.expiresAt);

  await sendEmailTemplate(
    invitation.recipientEmail,
    env.EMAILJS_INVITATION_TEMPLATE_ID,
    {
      to_name: invitation.recipientName,
      subject: "دعوة للانضمام إلى نظام راسخ",
      email_title: "لديك دعوة للانضمام إلى نظام راسخ",
      message: "تمت دعوتك للانضمام إلى جهة في نظام راسخ. راجع تفاصيل الدعوة ثم أكمل التسجيل.",
      invitation_url: invitation.invitationUrl,
      organization_name: invitation.organizationName,
      role_name: invitation.roleName,
      scope_name: invitation.scopeName,
      inviter_name: invitation.inviterName,
      expires_at: expiresAt,
      action_label: "قبول الدعوة",
    },
  );
}

export async function sendAccountEmail(
  recipientEmail: string,
  recipientName: string,
  purpose: "email_verification" | "password_reset",
  actionUrl: string,
): Promise<void> {
  const isVerification = purpose === "email_verification";
  await sendEmailTemplate(
    recipientEmail,
    env.EMAILJS_ACCOUNT_TEMPLATE_ID,
    {
      to_name: recipientName,
      subject: isVerification
        ? "تأكيد البريد الإلكتروني – نظام راسخ"
        : "استعادة كلمة المرور – نظام راسخ",
      email_title: isVerification
        ? "تأكيد البريد الإلكتروني"
        : "استعادة كلمة المرور",
      message: isVerification
        ? "اضغط على الرابط لتأكيد بريدك الإلكتروني وإكمال إنشاء حسابك."
        : "اضغط على الرابط لإنشاء كلمة مرور جديدة. إذا لم تطلب ذلك فتجاهل الرسالة.",
      action_url: actionUrl,
      action_label: isVerification ? "تأكيد البريد الإلكتروني" : "تعيين كلمة مرور جديدة",
    },
  );
}
