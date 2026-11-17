/* ==========================================================================
   متغيرات النظام المؤقتة (لحفظ حالة الدخول ورمز التحقق أثناء الجلسة)
   ========================================================================== */
let currentAuthMode = 'login'; // الوضع الحالي: 'login' (دخول) أو 'register' (مستخدم جديد)
let generatedOtp = '';         // لتخزين رمز التحقق المُرسل للمقارنة


/* ==========================================================================
   [1] وظيفة التبديل بين (تسجيل دخول) و (مستخدم جديد)
   - الوظيفة: تُظهر أو تُخفي حقول الاسم والصفة وكود الدعوة، وتغيّر نص الزر الرئيسي.
   - طريقة التعديل مستقبلاً: لتغيير نص الزر عند التسجيل، عدّل كلمة 'إنشاء حساب والمتابعة'.
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
   [2] المرحلة الأولى: الانتقال من إدخال البيانات إلى اختيار وسيلة التحقق
   - الوظيفة: تلتقط البريد والجوال المدخلين وتعرض شاشة الاختيار (جوال أو بريد).
   ========================================================================== */
document.getElementById('rasikhLoginForm')?.addEventListener('submit', function(event) {
    event.preventDefault();

    const email = document.getElementById('userEmail').value.trim();
    const phone = document.getElementById('userPhone').value.trim();

    // عرض البيانات المدخلة داخل بطاقات الاختيار
    document.getElementById('displayPhone').textContent = phone;
    document.getElementById('displayEmail').textContent = email;

    // إخفاء المرحلة الأولى والتبويبات، وإظهار شاشة اختيار وسيلة الإرسال
    document.getElementById('authTabs').style.display = 'none';
    document.getElementById('rasikhLoginForm').style.display = 'none';
    document.getElementById('otpMethodSection').style.display = 'block';
});


/* ==========================================================================
   [3] المرحلة الثانية: إرسال رمز التحقق عبر الوسيلة المختارة (جوال أو بريد)
   - الوظيفة: تولّد رمز تحقق من 4 أرقام وتنتقل لشاشة إدخال الرمز.
   - طريقة التعديل مستقبلاً: عند الربط ببوابة رسائل SMS أو بريد حقيقية، ضع كود
     الإرسال مكان سطر (alert) واحذف إظهار الرمز في التنبيه.
   ========================================================================== */
function sendSelectedOtp() {
    const selectedChannel = document.querySelector('input[name="otpChannel"]:checked').value;
    const phone = document.getElementById('userPhone').value.trim();
    const email = document.getElementById('userEmail').value.trim();

    // توليد رمز تحقق عشوائي من 4 أرقام للتجربة
    generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();

    const targetText = selectedChannel === 'phone' ? `الجوال (${phone})` : `البريد (${email})`;
    document.getElementById('otpSentMessage').textContent = `تم إرسال رمز التحقق إلى ${targetText}`;

    // تنبيه تجريبي يظهر لك الرمز لتتمكن من اختباره مباشرة
    alert(`رمز التحقق التجريبي الخاص بك هو: ${generatedOtp}`);

    document.getElementById('otpMethodSection').style.display = 'none';
    document.getElementById('otpVerifySection').style.display = 'block';
    document.getElementById('otpInput').value = '';
    document.getElementById('otpInput').focus();
}


/* ==========================================================================
   [4] المرحلة الثالثة: التحقق من الرمز المدخل والدخول للنظام
   - الوظيفة: تطابق الرمز المدخل مع الرمز المُرسل وتحفظ بيانات الجلسة في المتصفح.
   - طريقة التعديل مستقبلاً: بعد تجهيز صفحة الطلاب، فعّل سطر الانتقال (window.location.href).
   ========================================================================== */
function verifyOtpCode() {
    const enteredCode = document.getElementById('otpInput').value.trim();

    if (enteredCode === generatedOtp) {
        // حفظ بيانات المستخدم محلياً في المتصفح (يعمل بدون إنترنت)
        const userData = {
            name: document.getElementById('fullName').value.trim() || 'مستخدم نظام راسخ',
            role: document.getElementById('userRole').value,
            email: document.getElementById('userEmail').value.trim(),
            phone: document.getElementById('userPhone').value.trim(),
            loggedIn: true
        };
        localStorage.setItem('rasikh_current_user', JSON.stringify(userData));

        alert(`أهلاً بك في نظام راسخ (${userData.name})!\nتم تسجيل الدخول بنجاح.`);
        // window.location.href = "pages/students.html"; // يُفعّل عند إنشاء صفحة الطلاب
    } else {
        alert('رمز التحقق غير صحيح، يرجى التأكد وإعادة المحاولة.');
    }
}


/* ==========================================================================
   [5] أزرار الرجوع بين خطوات الدخول
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


/* ==========================================================================
   [6] وظيفة زر (إرسال دعوة)
   - طريقة التعديل مستقبلاً: تُربط بنافذة توليد رابط دعوة للمعلمين والمشرفين.
   ========================================================================== */
function sendInvitation() {
    alert('سيتم هنا فتح نافذة إدخال بيانات المدعو (معلم / مشرف) وإرسال رابط الدعوة له.');
}


/* ==========================================================================
   [7] وظيفة (استرجاع نسخة احتياطية للنظام)
   - الوظيفة: تقرأ ملف النسخة الاحتياطية (.json) وتستعيد البيانات في المتصفح.
   ========================================================================== */
document.getElementById('restoreBackupLink')?.addEventListener('click', function(event) {
    event.preventDefault();

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.bak';

    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(evt) {
            try {
                const backupData = JSON.parse(evt.target.result);
                localStorage.setItem('rasikh_backup_data', JSON.stringify(backupData));
                alert(`تم استرجاع النسخة الاحتياطية (${file.name}) بنجاح!`);
            } catch (err) {
                alert(`تم اختيار الملف (${file.name})، تأكد أن صيغته JSON صالحة.`);
            }
        };
        reader.readAsText(file);
    };

    input.click();
});
