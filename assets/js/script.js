/* ==========================================================================
   [1] إعدادات خدمة الإرسال المباشر (EmailJS)
   ========================================================================== */
const EMAILJS_CONFIG = {
    PUBLIC_KEY: 'R-1PwjvGMVEsTg1j5',
    SERVICE_ID: 'service_5lcvg4g',
    TEMPLATE_ID: 'template_mzni57z'
};

if (typeof emailjs !== 'undefined') {
    emailjs.init({ publicKey: EMAILJS_CONFIG.PUBLIC_KEY });
}

let currentAuthMode = 'login';
let generatedOtp = '';

/* ==========================================================================
   [2] نظام الإشعارات الأنيق (Toast)
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
   [4] الانتقال من إدخال البيانات إلى وسيلة التحقق
   ========================================================================== */
document.getElementById('rasikhLoginForm')?.addEventListener('submit', function(event) {
    event.preventDefault();

    const email = document.getElementById('userEmail').value.trim();
    const phone = document.getElementById('userPhone')?.value.trim() || '';

    if (document.getElementById('displayPhone')) {
        document.getElementById('displayPhone').textContent = phone;
    }
    if (document.getElementById('displayEmail')) {
        document.getElementById('displayEmail').textContent = email;
    }

    document.getElementById('authTabs').style.display = 'none';
    document.getElementById('rasikhLoginForm').style.display = 'none';
    document.getElementById('otpMethodSection').style.display = 'block';
});

/* ==========================================================================
   [5] إرسال رمز التحقق الفعلي مباشرة عبر البريد الإلكتروني (EmailJS)
   ========================================================================== */
function sendSelectedOtp() {
    const email = document.getElementById('userEmail').value.trim();
    const userName = document.getElementById('fullName')?.value.trim() || 'عبدالرحمن عبدالقادر';
    const sendBtn = document.getElementById('sendOtpBtn');

    if (!email) {
        showToast('يرجى إدخال البريد الإلكتروني أولاً');
        return;
    }

    if (typeof emailjs === 'undefined') {
        showToast('تعذر تحميل مكتبة الإرسال، تأكد من اتصال الإنترنت');
        return;
    }

    generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();

    sendBtn.disabled = true;
    sendBtn.textContent = 'جاري إرسال الرمز لبريدك...';

    emailjs.send(EMAILJS_CONFIG.SERVICE_ID, EMAILJS_CONFIG.TEMPLATE_ID, {
        to_email: email,
        user_name: userName,
        otp_code: generatedOtp
    }).then(() => {
        sendBtn.disabled = false;
        sendBtn.textContent = 'إرسال رمز التحقق';
        document.getElementById('otpSentMessage').innerHTML =
            `تم إرسال رمز التحقق بنجاح إلى بريدك الإلكتروني:<br><strong style="color:#0B1F3F; direction:ltr; display:inline-block; margin-top:4px;">${email}</strong>`;
        showToast('تم إرسال رمز التحقق إلى بريدك بنجاح');
        goToVerifyScreen();
    }).catch((error) => {
        sendBtn.disabled = false;
        sendBtn.textContent = 'إرسال رمز التحقق';
        console.error('EmailJS Error:', error);
        const errorMsg = error?.text || 'تأكد من تطابق الحقول في EmailJS';
        showToast(`فشل الإرسال: ${errorMsg}`);
    });
}

function goToVerifyScreen() {
    document.getElementById('otpMethodSection').style.display = 'none';
    document.getElementById('otpVerifySection').style.display = 'block';
    document.getElementById('otpInput').value = '';
    document.getElementById('otpInput').focus();
}

/* ==========================================================================
   [6] التحقق من الرمز والانتقال التلقائي إلى لوحة التحكم
   ========================================================================== */
function verifyOtpCode() {
    const enteredCode = document.getElementById('otpInput').value.trim();

    if (enteredCode === generatedOtp && generatedOtp !== '') {
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
    } else {
        showToast('رمز التحقق غير صحيح، يرجى التأكد من البريد');
    }
}

/* ==========================================================================
   [7] أزرار الرجوع واسترجاع النسخة الاحتياطية
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
