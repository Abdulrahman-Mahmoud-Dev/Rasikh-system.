/* ==========================================================================
   [1] تهيئة البيانات الأساسية في المتصفح (تعمل بدون إنترنت)
   - الوظيفة: تجهيز هيكل البيانات الموحد للنظام وقائمة الأعوام القابلة للزيادة.
   - طريقة التوسع مستقبلاً: لإضافة قسم بيانات جديد (مثل المصروفات)، أضف مفتاحاً
     جديداً داخل كائن (defaultData).
   ========================================================================== */
const STORAGE_KEY = 'rasikh_system_data_v1';

const defaultData = {
    years: ['1447 هـ', '1448 هـ'],
    activeYear: '1448 هـ',
    activeMonth: 'محرم',
    association: {
        name: '',
        manager: ''
    },
    mosques: [],
    circles: [],
    students: []
};

function getSystemData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultData));
        return JSON.parse(JSON.stringify(defaultData));
    }
    return JSON.parse(saved);
}

function saveSystemData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}


/* ==========================================================================
   [2] نظام الإشعارات الأنيق (بديل رسائل alert المنبثقة)
   - الوظيفة: يعرض رسالة تأكيد هادئة أسفل الشاشة لمدة 3 ثوانٍ ثم تختفي.
   ========================================================================== */
function showToast(message) {
    const toast = document.getElementById('rasikhToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}


/* ==========================================================================
   [3] إدارة الأعوام الهجرية والفترات التشغيلية (توسع تلقائي لأي عام مستقبلي)
   - الوظيفة: تعبئة قائمة السنوات وإضافة سنة جديدة تلقائياً بضغطة زر.
   ========================================================================== */
function renderPeriodControls() {
    const data = getSystemData();
    const yearSelect = document.getElementById('hijriYearSelect');
    const monthSelect = document.getElementById('hijriMonthSelect');

    yearSelect.innerHTML = data.years
        .map(year => `<option value="${year}" ${year === data.activeYear ? 'selected' : ''}>${year}</option>`)
        .join('');

    monthSelect.value = data.activeMonth;
    document.getElementById('statActiveYear').textContent = data.activeYear;
}

function addNewHijriYear() {
    const data = getSystemData();
    // استخراج آخر رقم سنة وإضافة سنة جديدة تلقائياً (مثلاً 1448 -> 1449)
    const lastYearStr = data.years[data.years.length - 1] || '1448 هـ';
    const lastYearNum = parseInt(lastYearStr.replace(/\D/g, ''), 10) || 1448;
    const nextYear = `${lastYearNum + 1} هـ`;

    if (!data.years.includes(nextYear)) {
        data.years.push(nextYear);
    }
    data.activeYear = nextYear;
    saveSystemData(data);

    renderPeriodControls();
    showToast(`تمت إضافة وتفعيل العام الجديد (${nextYear})`);
}

function changeActivePeriod() {
    const data = getSystemData();
    data.activeYear = document.getElementById('hijriYearSelect').value;
    data.activeMonth = document.getElementById('hijriMonthSelect').value;
    saveSystemData(data);

    document.getElementById('statActiveYear').textContent = data.activeYear;
    showToast(`تم الانتقال إلى: ${data.activeMonth} - ${data.activeYear}`);
}


/* ==========================================================================
   [4] إدارة بيانات الجمعية / الجهة المشرفة
   ========================================================================== */
function loadAssociationInfo() {
    const data = getSystemData();
    document.getElementById('assocName').value = data.association.name || '';
    document.getElementById('assocManager').value = data.association.manager || '';
}

function saveAssociationInfo(event) {
    event.preventDefault();
    const data = getSystemData();
    data.association.name = document.getElementById('assocName').value.trim();
    data.association.manager = document.getElementById('assocManager').value.trim();
    saveSystemData(data);
    showToast('تم حفظ بيانات الجمعية بنجاح');
}


/* ==========================================================================
   [5] إدارة المساجد (إضافة، عرض، حذف)
   ========================================================================== */
function addMosque(event) {
    event.preventDefault();
    const data = getSystemData();

    const newMosque = {
        id: 'msq_' + Date.now(),
        name: document.getElementById('mosqueName').value.trim(),
        supervisor: document.getElementById('mosqueSupervisor').value.trim()
    };

    data.mosques.push(newMosque);
    saveSystemData(data);

    document.getElementById('mosqueForm').reset();
    renderAllDashboard();
    showToast(`تمت إضافة (${newMosque.name}) بنجاح`);
}

function deleteMosque(mosqueId) {
    const data = getSystemData();
    data.mosques = data.mosques.filter(m => m.id !== mosqueId);
    // حذف الحلقات المرتبطة بالمسجد المحذوف تلقائياً
    data.circles = data.circles.filter(c => c.mosqueId !== mosqueId);
    saveSystemData(data);

    renderAllDashboard();
    showToast('تم حذف المسجد والحلقات المرتبطة به');
}

function renderMosques() {
    const data = getSystemData();
    const tbody = document.getElementById('mosquesTableBody');
    const select = document.getElementById('circleMosqueSelect');

    if (data.mosques.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">لا توجد مساجد مضافة بعد</td></tr>`;
        select.innerHTML = `<option value="">-- أضف مسجداً أولاً --</option>`;
        return;
    }

    tbody.innerHTML = data.mosques.map((m, index) => `
        <tr>
            <td>${index + 1}</td>
            <td><strong>${m.name}</strong></td>
            <td>${m.supervisor}</td>
            <td><button type="button" class="btn-small btn-danger" onclick="deleteMosque('${m.id}')">حذف</button></td>
        </tr>
    `).join('');

    select.innerHTML = data.mosques.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}


/* ==========================================================================
   [6] إدارة الحلقات القرآنية وربطها بالمساجد
   ========================================================================== */
function addCircle(event) {
    event.preventDefault();
    const data = getSystemData();
    const mosqueId = document.getElementById('circleMosqueSelect').value;

    if (!mosqueId) {
        showToast('يرجى إضافة مسجد أولاً قبل إنشاء الحلقة');
        return;
    }

    const newCircle = {
        id: 'crl_' + Date.now(),
        mosqueId: mosqueId,
        name: document.getElementById('circleName').value.trim(),
        teacher: document.getElementById('circleTeacher').value.trim()
    };

    data.circles.push(newCircle);
    saveSystemData(data);

    document.getElementById('circleForm').reset();
    renderAllDashboard();
    showToast(`تمت إضافة (${newCircle.name}) بنجاح`);
}

function deleteCircle(circleId) {
    const data = getSystemData();
    data.circles = data.circles.filter(c => c.id !== circleId);
    saveSystemData(data);

    renderAllDashboard();
    showToast('تم حذف الحلقة بنجاح');
}

function renderCircles() {
    const data = getSystemData();
    const tbody = document.getElementById('circlesTableBody');

    if (data.circles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">لا توجد حلقات مضافة بعد</td></tr>`;
        return;
    }

    tbody.innerHTML = data.circles.map((c, index) => {
        const mosque = data.mosques.find(m => m.id === c.mosqueId);
        const mosqueName = mosque ? mosque.name : 'غير محدد';
        return `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${c.name}</strong></td>
                <td>${mosqueName}</td>
                <td>${c.teacher}</td>
                <td><button type="button" class="btn-small btn-danger" onclick="deleteCircle('${c.id}')">حذف</button></td>
            </tr>
        `;
    }).join('');
}


/* ==========================================================================
   [7] تحديث الإحصائيات وبيانات المستخدم عند فتح الصفحة
   ========================================================================== */
function updateStats() {
    const data = getSystemData();
    document.getElementById('statMosquesCount').textContent = data.mosques.length;
    document.getElementById('statCirclesCount').textContent = data.circles.length;
    document.getElementById('statStudentsCount').textContent = data.students.length;
}

function loadCurrentUser() {
    const userRaw = localStorage.getItem('rasikh_current_user');
    if (userRaw) {
        const user = JSON.parse(userRaw);
        document.getElementById('currentUserBadge').textContent = user.name;
    }
}

function logoutUser() {
    localStorage.removeItem('rasikh_current_user');
}

function renderAllDashboard() {
    renderPeriodControls();
    loadAssociationInfo();
    renderMosques();
    renderCircles();
    updateStats();
}

// تشغيل التهيئة تلقائياً عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    loadCurrentUser();
    renderAllDashboard();
});
