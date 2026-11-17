/* ==========================================================================
   [1] الاتصال بقاعدة البيانات المحلية الموحدة للنظام
   - الوظيفة: قراءة وحفظ البيانات من نفس مخزن لوحة التحكم لضمان التزامن.
   - طريقة التوسع مستقبلاً: جميع السنوات والشهور تُنشأ تلقائياً دون تعديل الكود.
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

// مفتاح فريد يجمع العام والشهر النشط (مثال: "1448 هـ_محرم") لفصل سجلات كل شهر
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
   [3] إدارة الأعوام الهجرية والشهور (متزامنة مع لوحة التحكم وقابلة للزيادة)
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
    renderStudentsTable();
    showToast(`تمت إضافة وتفعيل العام الجديد (${nextYear})`);
}

function changeActivePeriod() {
    const data = getSystemData();
    data.activeYear = document.getElementById('hijriYearSelect').value;
    data.activeMonth = document.getElementById('hijriMonthSelect').value;
    saveSystemData(data);

    renderStudentsTable();
    showToast(`عرض سجل: ${data.activeMonth} - ${data.activeYear}`);
}


/* ==========================================================================
   [4] تعبئة قوائم الحلقات (في نموذج الإضافة وفي قائمة التصفية)
   ========================================================================== */
function populateCircleDropdowns() {
    const data = getSystemData();
    const addSelect = document.getElementById('studentCircleSelect');
    const filterSelect = document.getElementById('filterCircleSelect');

    if (data.circles.length === 0) {
        addSelect.innerHTML = `<option value="">-- أضف حلقة من لوحة التحكم أولاً --</option>`;
        filterSelect.innerHTML = `<option value="all">جميع الحلقات (لا توجد حلقات)</option>`;
        return;
    }

    const optionsHtml = data.circles.map(c => {
        const mosque = data.mosques.find(m => m.id === c.mosqueId);
        const mosqueLabel = mosque ? ` (${mosque.name})` : '';
        return `<option value="${c.id}">${c.name}${mosqueLabel}</option>`;
    }).join('');

    addSelect.innerHTML = optionsHtml;
    filterSelect.innerHTML = `<option value="all">جميع الحلقات</option>` + optionsHtml;
}


/* ==========================================================================
   [5] إضافة طالب جديد وحذف طالب
   - طريقة التوسع مستقبلاً: لإضافة حقل جديد للطالب، أضفه داخل كائن (newStudent).
   ========================================================================== */
function addStudent(event) {
    event.preventDefault();
    const data = getSystemData();
    const circleId = document.getElementById('studentCircleSelect').value;

    if (!circleId) {
        showToast('يرجى إضافة حلقة من لوحة التحكم أولاً');
        return;
    }

    const newStudent = {
        id: 'std_' + Date.now(),
        circleId: circleId,
        name: document.getElementById('studentName').value.trim(),
        prevJuz: parseInt(document.getElementById('studentPrevJuz').value, 10) || 0,
        guardianPhone: document.getElementById('guardianPhone').value.trim(),
        records: {} // تُخزّن هنا سجلات كل شهر وعام بشكل مستقل
    };

    data.students.push(newStudent);
    saveSystemData(data);

    document.getElementById('studentForm').reset();
    populateCircleDropdowns();
    renderStudentsTable();
    showToast(`تم تسجيل الطالب (${newStudent.name}) بنجاح`);
}

function deleteStudent(studentId) {
    const data = getSystemData();
    data.students = data.students.filter(s => s.id !== studentId);
    saveSystemData(data);

    renderStudentsTable();
    showToast('تم حذف سجل الطالب');
}


/* ==========================================================================
   [6] رصد وتحديث الحضور والصفحات والتقدير تلقائياً لكل شهر وعام
   - الوظيفة: تحفظ أي تعديل يجريه المعلم في الجدول فوراً وتمنح وسام التميز.
   - طريقة التعديل مستقبلاً: لتغيير شروط الوسام، عدّل دالة (getStudentBadge).
   ========================================================================== */
function updateStudentRecord(studentId, field, value) {
    const data = getSystemData();
    const periodKey = getCurrentPeriodKey(data);
    const student = data.students.find(s => s.id === studentId);
    if (!student) return;

    if (!student.records) student.records = {};
    if (!student.records[periodKey]) {
        student.records[periodKey] = {
            attendance: 0,
            memPages: 0,
            revPages: 0,
            grade: 'ممتاز'
        };
    }

    student.records[periodKey][field] = field === 'grade' ? value : (parseFloat(value) || 0);
    saveSystemData(data);

    renderStudentsTable();
    showToast(`تم تحديث سجل (${student.name})`);
}

function getStudentBadge(rec) {
    if (rec.attendance >= 20 && rec.memPages >= 10) {
        return `<span style="display:inline-block; margin-top:4px; font-size:0.75rem; background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:12px; font-weight:700;">🏅 وسام التميز</span>`;
    }
    if (rec.attendance >= 18) {
        return `<span style="display:inline-block; margin-top:4px; font-size:0.75rem; background:#e0f2fe; color:#075985; padding:2px 8px; border-radius:12px; font-weight:700;">🎖️ وسام الانضباط</span>`;
    }
    return '';
}


/* ==========================================================================
   [7] عرض جدول المتابعة اليومية والفهرس التفاعلي للطلاب
   ========================================================================== */
function renderStudentsTable() {
    const data = getSystemData();
    const periodKey = getCurrentPeriodKey(data);
    const selectedCircle = document.getElementById('filterCircleSelect').value;
    const tbody = document.getElementById('studentsTableBody');

    const filteredStudents = selectedCircle === 'all'
        ? data.students
        : data.students.filter(s => s.circleId === selectedCircle);

    if (filteredStudents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">لا يوجد طلاب مسجلون في هذه القائمة بعد</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredStudents.map((student, index) => {
        const circle = data.circles.find(c => c.id === student.circleId);
        const circleName = circle ? circle.name : 'غير محدد';

        // جلب سجل الطالب للشهر والعام النشطين (أو قيم افتراضية صفرية)
        const rec = (student.records && student.records[periodKey])
            ? student.records[periodKey]
            : { attendance: 0, memPages: 0, revPages: 0, grade: 'ممتاز' };

        const badgeHtml = getStudentBadge(rec);

        return `
            <tr>
                <td>${index + 1}</td>
                <td>
                    <strong>${student.name}</strong>
                    <div style="font-size:0.78rem; color:var(--text-muted);">الحفظ السابق: ${student.prevJuz} جزء</div>
                    ${badgeHtml}
                </td>
                <td>${circleName}</td>
                <td>
                    <input type="number" min="0" max="31" value="${rec.attendance}"
                        style="width:65px; padding:5px; border:1px solid var(--border-color); border-radius:6px; text-align:center;"
                        onchange="updateStudentRecord('${student.id}', 'attendance', this.value)">
                </td>
                <td>
                    <input type="number" min="0" step="0.5" value="${rec.memPages}"
                        style="width:70px; padding:5px; border:1px solid var(--border-color); border-radius:6px; text-align:center;"
                        onchange="updateStudentRecord('${student.id}', 'memPages', this.value)">
                </td>
                <td>
                    <input type="number" min="0" step="0.5" value="${rec.revPages}"
                        style="width:70px; padding:5px; border:1px solid var(--border-color); border-radius:6px; text-align:center;"
                        onchange="updateStudentRecord('${student.id}', 'revPages', this.value)">
                </td>
                <td>
                    <select style="padding:5px; border:1px solid var(--border-color); border-radius:6px; font-weight:600; color:var(--primary-navy);"
                        onchange="updateStudentRecord('${student.id}', 'grade', this.value)">
                        <option value="ممتاز" ${rec.grade === 'ممتاز' ? 'selected' : ''}>ممتاز</option>
                        <option value="جيد جداً" ${rec.grade === 'جيد جداً' ? 'selected' : ''}>جيد جداً</option>
                        <option value="جيد" ${rec.grade === 'جيد' ? 'selected' : ''}>جيد</option>
                        <option value="يحتاج متابعة" ${rec.grade === 'يحتاج متابعة' ? 'selected' : ''}>يحتاج متابعة</option>
                    </select>
                </td>
                <td>
                    <button type="button" class="btn-small btn-danger" onclick="deleteStudent('${student.id}')">حذف</button>
                </td>
            </tr>
        `;
    }).join('');
}


/* ==========================================================================
   [8] تهيئة الصفحة عند التحميل
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
    populateCircleDropdowns();
    renderStudentsTable();
});
