/* ==========================================================================
   [1] الاتصال بقاعدة البيانات المحلية الموحدة للنظام
   - الوظيفة: قراءة وحفظ البيانات المتزامنة مع لوحة التحكم وصفحة الطلاب.
   ========================================================================== */
const STORAGE_KEY = 'rasikh_system_data_v1';

const defaultData = {
    years: ['1447 هـ', '1448 هـ'],
    activeYear: '1448 هـ',
    activeMonth: 'محرم',
    association: { name: '', manager: '' },
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

function getCurrentPeriodKey(data) {
    return `${data.activeYear}_${data.activeMonth}`;
}


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
    }, 3000);
}


/* ==========================================================================
   [3] إدارة الأعوام الهجرية والشهور (قابل للزيادة لأي عام مستقبلي)
   ========================================================================== */
function renderPeriodControls() {
    const data = getSystemData();
    const yearSelect = document.getElementById('hijriYearSelect');
    const monthSelect = document.getElementById('hijriMonthSelect');

    yearSelect.innerHTML = data.years
        .map(year => `<option value="${year}" ${year === data.activeYear ? 'selected' : ''}>${year}</option>`)
        .join('');

    monthSelect.value = data.activeMonth;
}

function addNewHijriYear() {
    const data = getSystemData();
    const lastYearStr = data.years[data.years.length - 1] || '1448 هـ';
    const lastYearNum = parseInt(lastYearStr.replace(/\D/g, ''), 10) || 1448;
    const nextYear = `${lastYearNum + 1} هـ`;

    if (!data.years.includes(nextYear)) {
        data.years.push(nextYear);
    }
    data.activeYear = nextYear;
    saveSystemData(data);

    renderPeriodControls();
    renderReportTable();
    showToast(`تمت إضافة وتفعيل العام الجديد (${nextYear})`);
}

function changeActivePeriod() {
    const data = getSystemData();
    data.activeYear = document.getElementById('hijriYearSelect').value;
    data.activeMonth = document.getElementById('hijriMonthSelect').value;
    saveSystemData(data);

    renderReportTable();
    showToast(`عرض تقرير: ${data.activeMonth} - ${data.activeYear}`);
}


/* ==========================================================================
   [4] فلاتر التصفية (المسجد والحلقات التابعة له)
   - الوظيفة: تصفية الفهرس حسب المسجد أو الحلقة وتحديث خيارات الحلقات تلقائياً.
   ========================================================================== */
function populateReportFilters() {
    const data = getSystemData();
    const mosqueSelect = document.getElementById('reportMosqueFilter');

    mosqueSelect.innerHTML = `<option value="all">جميع المساجد</option>` +
        data.mosques.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    updateCircleFilterOptions();
}

function updateCircleFilterOptions() {
    const data = getSystemData();
    const selectedMosque = document.getElementById('reportMosqueFilter').value;
    const circleSelect = document.getElementById('reportCircleFilter');

    const availableCircles = selectedMosque === 'all'
        ? data.circles
        : data.circles.filter(c => c.mosqueId === selectedMosque);

    circleSelect.innerHTML = `<option value="all">جميع الحلقات</option>` +
        availableCircles.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function onMosqueFilterChange() {
    updateCircleFilterOptions();
    renderReportTable();
}


/* ==========================================================================
   [5] بناء جدول الفهرس الشهري وحساب الإحصائيات وترويسة الطباعة
   ========================================================================== */
function renderReportTable() {
    const data = getSystemData();
    const periodKey = getCurrentPeriodKey(data);
    const selectedMosque = document.getElementById('reportMosqueFilter').value;
    const selectedCircle = document.getElementById('reportCircleFilter').value;
    const tbody = document.getElementById('reportsTableBody');

    const filteredStudents = data.students.filter(student => {
        const circle = data.circles.find(c => c.id === student.circleId);
        if (selectedMosque !== 'all' && (!circle || circle.mosqueId !== selectedMosque)) {
            return false;
        }
        if (selectedCircle !== 'all' && student.circleId !== selectedCircle) {
            return false;
        }
        return true;
    });

    let totalMem = 0;
    let totalRev = 0;
    let totalAtt = 0;

    if (filteredStudents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">لا توجد بيانات طلاب مطابقة للتصفية الحالية</td></tr>`;
    } else {
        tbody.innerHTML = filteredStudents.map((student, index) => {
            const circle = data.circles.find(c => c.id === student.circleId);
            const mosque = circle ? data.mosques.find(m => m.id === circle.mosqueId) : null;

            const circleName = circle ? circle.name : 'غير محدد';
            const mosqueName = mosque ? mosque.name : 'غير محدد';

            const rec = (student.records && student.records[periodKey])
                ? student.records[periodKey]
                : { attendance: 0, memPages: 0, revPages: 0, grade: 'ممتاز' };

            totalMem += Number(rec.memPages) || 0;
            totalRev += Number(rec.revPages) || 0;
            totalAtt += Number(rec.attendance) || 0;

            return `
                <tr>
                    <td>${index + 1}</td>
                    <td><strong>${student.name}</strong></td>
                    <td>${mosqueName}</td>
                    <td>${circleName}</td>
                    <td>${student.prevJuz || 0} جزء</td>
                    <td>${rec.attendance} يوم</td>
                    <td>${rec.memPages} صفحة</td>
                    <td>${rec.revPages} صفحة</td>
                    <td><strong>${rec.grade}</strong></td>
                </tr>
            `;
        }).join('');
    }

    document.getElementById('repTotalMem').textContent = totalMem;
    document.getElementById('repTotalRev').textContent = totalRev;
    document.getElementById('repStudentsCount').textContent = filteredStudents.length;
    document.getElementById('repAvgAtt').textContent = filteredStudents.length > 0
        ? (totalAtt / filteredStudents.length).toFixed(1)
        : '0';

    const assocTitle = data.association.name || 'نظام راسخ لإدارة الحلقات القرآنية';
    const mosqueText = document.getElementById('reportMosqueFilter').selectedOptions[0]?.text || 'جميع المساجد';
    const circleText = document.getElementById('reportCircleFilter').selectedOptions[0]?.text || 'جميع الحلقات';

    document.getElementById('printHeaderAssoc').textContent = assocTitle;
    document.getElementById('printHeaderPeriod').textContent = `فهرس الطلاب وتقرير الإنجاز الشهري - شهر ${data.activeMonth} لعام ${data.activeYear}`;
    document.getElementById('printHeaderScope').textContent = `النطاق: ${mosqueText} | ${circleText}`;
}


/* ==========================================================================
   [6] تصدير واسترجاع النسخة الاحتياطية الكاملة (ملف JSON)
   ========================================================================== */
function exportBackupFile() {
    const data = getSystemData();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    const dateTag = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `rasikh-backup-${dateTag}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showToast('تم تنزيل ملف النسخة الاحتياطية بنجاح');
}

function triggerRestoreBackup() {
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
                saveSystemData(imported);
                renderPeriodControls();
                populateReportFilters();
                renderReportTable();
                showToast('تمت استعادة جميع البيانات من النسخة الاحتياطية بنجاح');
            } catch (err) {
                showToast('حدث خطأ أثناء قراءة الملف');
            }
        };
        reader.readAsText(file);
    };

    input.click();
}


/* ==========================================================================
   [7] تهيئة الصفحة عند التحميل
   ========================================================================== */
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

document.addEventListener('DOMContentLoaded', () => {
    loadCurrentUser();
    renderPeriodControls();
    populateReportFilters();
    renderReportTable();
});
