/* ==========================================================================
   [1] إعدادات EmailJS والثوابت
   ========================================================================== */
const EMAILJS_CONFIG = {
    PUBLIC_KEY: 'R-1PwjvGMVEsTg1j5',
    SERVICE_ID: 'service_5lcvg4g',
    TEMPLATE_ID: 'template_mzni57z'
};

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000;   // صلاحية الرمز 5 دقائق
const MAX_ATTEMPTS = 5;             // عدد المحاولات الخاطئة المسموح
const RESEND_SECONDS = 60;          // مهلة إعادة الإرسال

if (typeof emailjs !== 'undefined') {
    emailjs.init({ publicKey: EMAILJS_CONFIG.PUBLIC_KEY });
}

let currentAuthMode = 'login';
let generatedOtp = '';
let otpExpiresAt = 0;
let failedAttempts = 0;
let resendTimerId = null;

/* ==========================================================================
   [2] الإشعارات (Toast)
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
    const btnLabel = document.querySelector('#mainSubmitBtn span');
    const greet = document.getElementById('authGreet');
    const sub = document.getElementById('authSub');

    if (mode === 'register') {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        newUserFields.style.display = 'block';
        fullNameInput.required = true;
        btnLabel.textContent = 'إنشاء حساب والمتابعة';
        greet.textContent = 'حساب جديد';
        sub.textContent = 'أدخل بياناتك لإنشاء حسابك في النظام';
    } else {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        newUserFields.style.display = 'none';
        fullNameInput.required = false;
        btnLabel.textContent = 'متابعة';
        greet.textContent = 'أهلا بعودتك';
        sub.textContent = 'سجّل دخولك لمتابعة حلقاتك وطلابك';
    }
}

/* ==========================================================================
   [4] الانتقال من إدخال البيانات إلى وسيلة التحقق
   ========================================================================== */
document.getElementById('rasikhLoginForm')?.addEventListener('submit', function(event) {
    event.preventDefault();

    const email = document.getElementById('userEmail').value.trim();
    document.getElementById('displayEmail').textContent = email;

    document.getElementById('authTabs').style.display = 'none';
    document.getElementById('rasikhLoginForm').style.display = 'none';
    document.getElementById('otpMethodSection').style.display = 'block';
});

/* ==========================================================================
   [5] إرسال رمز التحقق عبر EmailJS
   ========================================================================== */
function sendSelectedOtp() {
    const email = document.getElementById('userEmail').value.trim();
    const userName = document.getElementById('fullName')?.value.trim() || 'عبدالرحمن عبدالقادر';
    const sendBtn = document.getElementById('sendOtpBtn');
    const resendBtn = document.getElementById('resendBtn');

    if (!email) {
        showToast('يرجى إدخال البريد الإلكتروني أولاً');
        return;
    }

    if (typeof emailjs === 'undefined') {
        showToast('تعذر تحميل مكتبة الإرسال، تأكد من اتصال الإنترنت');
        return;
    }

    const random = crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000;
    generatedOtp = String(random);
    otpExpiresAt = Date.now() + OTP_TTL_MS;
    failedAttempts = 0;

    sendBtn.disabled = true;
    sendBtn.textContent = 'جاري إرسال الرمز لبريدك...';
    if (resendBtn) resendBtn.disabled = true;

    emailjs.send(EMAILJS_CONFIG.SERVICE_ID, EMAILJS_CONFIG.TEMPLATE_ID, {
        to_email: email,
        user_name: userName,
        otp_code: generatedOtp
    }).then(() => {
        sendBtn.disabled = false;
        sendBtn.textContent = 'إرسال رمز التحقق الآن';
        setSentMessage(email);
        showToast('تم إرسال رمز التحقق إلى بريدك بنجاح');
        goToVerifyScreen();
    }).catch((error) => {
        sendBtn.disabled = false;
        sendBtn.textContent = 'إرسال رمز التحقق الآن';
        if (resendBtn) {
            resendBtn.disabled = false;
            resendBtn.textContent = 'إعادة إرسال الرمز';
        }
        console.error('EmailJS Error:', error);
        const errorMsg = error?.text || 'تأكد من تطابق الحقول في EmailJS';
        showToast(`فشل الإرسال: ${errorMsg}`);
    });
}

function setSentMessage(email) {
    const msg = document.getElementById('otpSentMessage');
    msg.textContent = `أرسلنا رمزا من ${OTP_LENGTH} أرقام إلى`;
    msg.appendChild(document.createElement('br'));
    const strong = document.createElement('strong');
    strong.className = 'sent-email';
    strong.dir = 'ltr';
    strong.textContent = email;
    msg.appendChild(strong);
}

function goToVerifyScreen() {
    document.getElementById('otpMethodSection').style.display = 'none';
    document.getElementById('otpVerifySection').style.display = 'block';
    otpBoxes.forEach(box => { box.value = ''; });
    otpBoxes[0]?.focus();
    startResendTimer();
}

/* ==========================================================================
   [6] خانات الرمز (إدخال تلقائي، حذف، لصق) ومؤقت إعادة الإرسال
   ========================================================================== */
const otpBoxes = Array.from(document.querySelectorAll('.otp-digit'));

otpBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(-1);
        if (box.value && i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
    });

    box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) otpBoxes[i - 1].focus();
    });

    box.addEventListener('paste', (e) => {
        e.preventDefault();
        const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, otpBoxes.length);
        digits.split('').forEach((d, k) => { otpBoxes[k].value = d; });
        otpBoxes[Math.min(digits.length, otpBoxes.length - 1)].focus();
    });
});

function startResendTimer() {
    clearInterval(resendTimerId);
    const btn = document.getElementById('resendBtn');
    let left = RESEND_SECONDS - 1;
    btn.disabled = true;

    const tick = () => {
        if (left < 0) {
            clearInterval(resendTimerId);
            btn.disabled = false;
            btn.textContent = 'إعادة إرسال الرمز';
            return;
        }
        btn.textContent = `إعادة الإرسال بعد 00:${String(left).padStart(2, '0')}`;
        left--;
    };

    tick();
    resendTimerId = setInterval(tick, 1000);
}

function resendOtp() {
    sendSelectedOtp();
}

/* ==========================================================================
   [7] التحقق من الرمز والانتقال إلى لوحة التحكم
   ========================================================================== */
function verifyOtpCode() {
    const enteredCode = otpBoxes.map(b => b.value).join('');

    if (generatedOtp === '') {
        showToast('اطلب رمز تحقق جديدا أولاً');
        return;
    }

    if (Date.now() > otpExpiresAt) {
        generatedOtp = '';
        showToast('انتهت صلاحية الرمز، اطلب رمزا جديدا');
        return;
    }

    if (enteredCode.length < OTP_LENGTH) {
        showToast('أدخل رمز التحقق كاملا');
        return;
    }

    if (enteredCode === generatedOtp) {
        generatedOtp = '';
        const userData = {
            name: document.getElementById('fullName')?.value.trim() || 'عبدالرحمن عبدالقادر',
            role: document.getElementById('userRole')?.value || 'مشرف عام',
            email: document.getElementById('userEmail').value.trim(),
            phone: document.getElementById('userPhone')?.value.trim() || '',
            loggedIn: true
        };
        localStorage.setItem('rasikh_current_user', JSON.stringify(userData));

        showToast(`أهلاً بك (${userData.name})! جاري الدخول...`);
        setTimeout(() => {
            window.location.href = 'pages/dashboard.html';
        }, 800);
        return;
    }

    failedAttempts++;
    if (failedAttempts >= MAX_ATTEMPTS) {
        generatedOtp = '';
        showToast('تجاوزت عدد المحاولات، اطلب رمزا جديدا');
    } else {
        showToast('رمز التحقق غير صحيح، يرجى التأكد من البريد');
    }
}

/* ==========================================================================
   [8] أزرار الرجوع واسترجاع النسخة الاحتياطية
   ========================================================================== */
function backToStep1() {
    document.getElementById('otpMethodSection').style.display = 'none';
    document.getElementById('authTabs').style.display = 'flex';
    document.getElementById('rasikhLoginForm').style.display = 'block';
}

function backToMethod() {
    clearInterval(resendTimerId);
    document.getElementById('otpVerifySection').style.display = 'none';
    document.getElementById('otpMethodSection').style.display = 'block';
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
                showToast('تم استرجاع النسخة الاحتياطية بنجاح!');
            } catch (err) {
                showToast('تعذر قراءة الملف، تأكد أنه بصيغة JSON صحيحة');
            }
        };
        reader.readAsText(file);
    };

    input.click();
});
