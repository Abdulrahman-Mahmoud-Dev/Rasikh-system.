/* ==========================================================================
   [1] إعدادات خدمة الإرسال المباشر (EmailJS)
   - طريقة التعديل: بعد إنشاء حساب مجاني في EmailJS، استبدل القيم الثلاث أدناه.
   ========================================================================== */
const EMAILJS_CONFIG = {
    PUBLIC_KEY: 'R-1PwjvGMVEsTg1j5',
    SERVICE_ID: 'service_5lcvg4g',
    TEMPLATE_ID: 'template_mzni57z'
};

if (typeof emailjs !== 'undefined' && EMAILJS_CONFIG.PUBLIC_KEY !== 'YOUR_PUBLIC_KEY') {
    emailjs.init(EMAILJS_CONFIG.PUBLIC_KEY);
}

let currentAuthMode = 'login';
let generatedOtp = '';


/* ==========================================================================
   [2] نظام الإشعارات الأنيق (بديل alert المنبثقة)
   ========================================================================== */
function showToast(message) {
    const toast = document.getElementById('rasikhToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3500);
}


/* ==========================================================================
   [3] التبديل بين (تسجيل دخول) و (مستخدم جديد)
   ========================================================================== */
function switchMode(mode) {
    currentAuthMode = mode;
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const newUserFields = document.getElementById('newUserFields');
    const fullNameInput = document.getElementById('fullName');
    const mainSubmitBtn = document.getElementById('mainSubmitBtn');

    if (mode === 'register') {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        newUserFields.style.display = 'block';
        fullNameInput.required = true;
        mainSubmitBtn.textContent = 'إنشاء حساب والمتابعة';
    } else {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        newUserFields.style.display = 'none';
        fullNameInput.required = false;
        mainSubmitBtn.textContent = 'تسجيل دخول';
    }
}


/* ==========================================================================
   [4] الانتقال من إدخال البيانات إلى اختيار وسيلة التحقق
   ========================================================================== */
document.getElementById('rasikhLoginForm')?.addEventListener('submit', function(event) {
    event.preventDefault();

    const email = document.getElementById('userEmail').value.trim();
    const phone = document.getElementById('userPhone').value.trim();

    document.getElementById('displayPhone').textContent = phone;
    document.getElementById('displayEmail').textContent = email;

    document.getElementById('authTabs').style.display = 'none';
    document.getElementById('rasikhLoginForm').style.display = 'none';
    document.getElementById('otpMethodSection').style.display = 'block';
});


/* ==========================================================================
   [5] إرسال رمز التحقق الحقيقي مباشرة عبر EmailJS
   - ملاحظة: رسائل الجوال (SMS) تتطلب بوابة مدفوعة وسيرفر؛ لذا البريد الإلكتروني
     يعمل مباشرة مجاناً من المتصفح.
   ========================================================================== */
function sendSelectedOtp() {
    const selectedChannel = document.querySelector('input[name="otpChannel"]:checked').value;
    const phone = document.getElementById('userPhone').value.trim();
    const email = document.getElementById('userEmail').value.trim();
    const userName = document.getElementById('fullName').value.trim() || 'مستخدم نظام راسخ';
    const sendBtn = document.getElementById('sendOtpBtn');

    generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();

    if (selectedChannel === 'email') {
        // التحقق هل تم وضع مفاتيح EmailJS الحقيقية أم لا
        if (EMAILJS_CONFIG.PUBLIC_KEY === 'YOUR_PUBLIC_KEY') {
            document.getElementById('otpSentMessage').innerHTML =
                `وضع التجربة (أضف مفاتيح EmailJS للإرسال الفعلي)<br>رمزك الحالي: <strong style="color:var(--accent-gold); font-size:1.2rem;">${generatedOtp}</strong>`;
            showToast('تم توليد الرمز في وضع التجربة');
            goToVerifyScreen();
            return;
        }

        sendBtn.disabled = true;
        sendBtn.textContent = 'جاري الإرسال لبريدك...';

        emailjs.send(EMAILJS_CONFIG.SERVICE_ID, EMAILJS_CONFIG.TEMPLATE_ID, {
            to_email: email,
            user_name: userName,
            otp_code: generatedOtp
        }).then(() => {
            sendBtn.disabled = false;
            sendBtn.textContent = 'إرسال رمز التحقق';
            document.getElementById('otpSentMessage').textContent = `تم إرسال رمز التحقق إلى بريدك (${email})`;
            showToast('تم إرسال الرمز إلى بريدك الإلكتروني بنجاح');
            goToVerifyScreen();
        }).catch(() => {
            sendBtn.disabled = false;
            sendBtn.textContent = 'إرسال رمز التحقق';
            showToast('تعذر الإرسال عبر البريد، تأكد من إعدادات EmailJS');
        });
    } else {
        // خيار الجوال (يتطلب ربط بوابة SMS مدفوعة مستقبلاً)
        document.getElementById('otpSentMessage').innerHTML =
            `إرسال SMS للجوال (${phone}) يتطلب بوابة مدفوعة؛<br>رمزك التجريبي للدخول: <strong style="color:var(--accent-gold); font-size:1.2rem;">${generatedOtp}</strong>`;
        showToast('تم توليد رمز الدخول التجريبي');
        goToVerifyScreen();
    }
}

function goToVerifyScreen() {
    document.getElementById('otpMethodSection').style.display = 'none';
    document.getElementById('otpVerifySection').style.display = 'block';
    document.getElementById('otpInput').value = '';
    document.getElementById('otpInput').focus();
}


/* ==========================================================================
   [6] التحقق من الرمز والانتقال التلقائي إلى لوحة التحكم الداخلية
   ========================================================================== */
function verifyOtpCode() {
    const enteredCode = document.getElementById('otpInput').value.trim();

    if (enteredCode === generatedOtp) {
        const userData = {
            name: document.getElementById('fullName').value.trim() || 'مستخدم نظام راسخ',
            role: document.getElementById('userRole').value,
            email: document.getElementById('userEmail').value.trim(),
            phone: document.getElementById('userPhone').value.trim(),
            loggedIn: true
        };
        localStorage.setItem('rasikh_current_user', JSON.stringify(userData));

        showToast(`أهلاً بك (${userData.name})! جاري فتح لوحة التحكم...`);
        setTimeout(() => {
            window.location.href = 'pages/dashboard.html';
        }, 1000);
    } else {
        showToast('رمز التحقق غير صحيح، يرجى المحاولة مرة أخرى');
    }
}


/* ==========================================================================
   [7] أزرار الرجوع والدعوة واسترجاع النسخة الاحتياطية المتزامنة
   ========================================================================== */
function backToStep1() {
    document.getElementById('otpMethodSection').style.display = 'none';
    document.getElementById('authTabs').style.display = 'flex';
    document.getElementById('rasikhLoginForm').style.display = 'block';
}

function backToMethod() {
    document.getElementById('otpVerifySection').style.display = 'none';
    document.getElementById('otpMethodSection').style.display = 'block';
}

function sendInvitation() {
    const inviteUrl = window.location.href;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(inviteUrl);
        showToast('تم نسخ رابط الدعوة للنظام، أرسله للمعلم أو المشرف');
    } else {
        showToast('انسخ رابط الصفحة من الأعلى وأرسله للمعلم');
    }
}

document.getElementById('restoreBackupLink')?.addEventListener('click', function(event) {
    event.preventDefault();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(evt) {
            try {
                const imported = JSON.parse(evt.target.result);
                if (!imported.years || !Array.isArray(imported.students)) {
                    showToast('ملف النسخة الاحتياطية غير صالح');
                    return;
                }
                localStorage.setItem('rasikh_system_data_v1', JSON.stringify(imported));
                showToast('تم استرجاع النسخة الاحتياطية بنجاح! سجّل دخولك الآن');
            } catch (err) {
                showToast('تعذر قراءة الملف، تأكد أنه بصيغة JSON صحيحة');
            }
        };
        reader.readAsText(file);
    };

    input.click();
});
