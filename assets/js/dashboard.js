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

let activeMosqueActionId = null;
let circleMosqueFilterId = null;
let pendingConfirmAction = null;

/* ==========================================================================
   [0] أدوات مساعدة
   ========================================================================== */
function icon(name) {
    return `<svg class="ic-svg" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// حماية النصوص المدخلة قبل عرضها داخل الصفحة
function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function getSystemData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultData));
        return JSON.parse(JSON.stringify(defaultData));
    }
    try {
        return JSON.parse(saved);
    } catch (e) {
        return JSON.parse(JSON.stringify(defaultData));
    }
}

function saveSystemData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function showToast(message) {
    const toast = document.getElementById('rasikhToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

/* ==========================================================================
   [1] التنقل السفلي والنوافذ المنبثقة
   ========================================================================== */
function switchBottomTab(tabName) {
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(btn => btn.classList.remove('active'));

    const targetView = document.getElementById('view' + tabName);
    const targetNav = document.getElementById('nav' + tabName);
    if (targetView) targetView.classList.add('active');
    if (targetNav) targetNav.classList.add('active');
    window.scrollTo({ top: 0 });
}

function openSheet(sheetId) {
    const el = document.getElementById(sheetId);
    if (el) el.classList.add('open');
}

function closeSheet(sheetId) {
    const el = document.getElementById(sheetId);
    if (el) el.classList.remove('open');
}

function closeSheetOnBackdrop(event, sheetId) {
    if (event.target.id === sheetId) closeSheet(sheetId);
}

// نافذة تأكيد موحدة للحذف
function askConfirm(title, text, onConfirm) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmText').textContent = text;
    pendingConfirmAction = onConfirm;
    openSheet('sheetConfirm');
}

function runConfirmedAction() {
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    closeSheet('sheetConfirm');
    if (typeof action === 'function') action();
}

/* ==========================================================================
   [2] التاريخ والفترة التشغيلية
   ========================================================================== */
function renderTodayDate() {
    const now = new Date();
    const greg = now.toLocaleDateString('en-GB');
    let hijri = '';
    try {
        hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
            day: 'numeric', month: 'numeric', year: 'numeric'
        }).format(now);
    } catch (e) {
        hijri = getSystemData().activeYear;
    }
    const el = document.getElementById('todayFormattedDate');
    if (el) el.textContent = `${greg} م / ${hijri}`;
}

function renderPeriodControls() {
    const data = getSystemData();
    const yearSelect = document.getElementById('hijriYearSelect');
    const monthSelect = document.getElementById('hijriMonthSelect');

    yearSelect.innerHTML = data.years
        .map(year => `<option value="${esc(year)}" ${year === data.activeYear ? 'selected' : ''}>${esc(year)}</option>`)
        .join('');

    monthSelect.value = data.activeMonth;
    document.getElementById('statActiveYear').textContent = data.activeYear;
    document.getElementById('statActiveMonth').textContent = data.activeMonth;
}

function addNewHijriYear() {
    const data = getSystemData();
    const lastYearStr = data.years[data.years.length - 1] || '1448 هـ';
    const lastYearNum = parseInt(lastYearStr.replace(/\D/g, ''), 10) || 1448;
    const nextYear = `${lastYearNum + 1} هـ`;

    if (!data.years.includes(nextYear)) data.years.push(nextYear);
    data.activeYear = nextYear;
    saveSystemData(data);

    renderPeriodControls();
    showToast(`تمت إضافة وتفعيل العام (${nextYear})`);
}

function changeActivePeriod() {
    const data = getSystemData();
    data.activeYear = document.getElementById('hijriYearSelect').value;
    data.activeMonth = document.getElementById('hijriMonthSelect').value;
    saveSystemData(data);

    renderPeriodControls();
    showToast(`تم الانتقال إلى: ${data.activeMonth} - ${data.activeYear}`);
}

/* ==========================================================================
   [3] إدارة المجمعات / المساجد
   ========================================================================== */
function addMosque(event) {
    event.preventDefault();
    const data = getSystemData();

    const newMosque = {
        id: 'msq_' + Date.now(),
        name: document.getElementById('mosqueName').value.trim(),
        district: document.getElementById('mosqueDistrict').value.trim(),
        supervisor: document.getElementById('mosqueSupervisor').value.trim()
    };

    data.mosques.push(newMosque);
    saveSystemData(data);

    document.getElementById('mosqueForm').reset();
    closeSheet('sheetAddMosque');
    renderAllDashboard();
    showToast(`تمت إضافة (${newMosque.name}) بنجاح`);
}

function openMosqueOptions(mosqueId) {
    const data = getSystemData();
    const mosque = data.mosques.find(m => m.id === mosqueId);
    if (!mosque) return;
    activeMosqueActionId = mosqueId;
    document.getElementById('selectedMosqueTitle').textContent =
        mosque.name + (mosque.district ? ` — ${mosque.district}` : '');
    openSheet('sheetMosqueActions');
}

// عرض حلقات المسجد المحدد فقط
function openMosqueCircles(mosqueId) {
    circleMosqueFilterId = mosqueId;
    renderCirclesCards();
    switchBottomTab('Circles');
}

function filterCirclesBySelectedMosque() {
    closeSheet('sheetMosqueActions');
    openMosqueCircles(activeMosqueActionId);
}

function clearMosqueFilter() {
    circleMosqueFilterId = null;
    renderCirclesCards();
}

function requestDeleteSelectedMosque() {
    const mosque = getSystemData().mosques.find(m => m.id === activeMosqueActionId);
    if (!mosque) return;
    const mosqueId = mosque.id;
    closeSheet('sheetMosqueActions');
    askConfirm('حذف المسجد', `سيتم حذف (${mosque.name}) وكل حلقاته وطلابه المسجلين فيها. هل تريد المتابعة؟`, () => deleteMosque(mosqueId));
}

function deleteMosque(mosqueId) {
    const data = getSystemData();
    const removedCircleIds = new Set(
        data.circles.filter(c => c.mosqueId === mosqueId).map(c => c.id)
    );
    data.mosques = data.mosques.filter(m => m.id !== mosqueId);
    data.circles = data.circles.filter(c => c.mosqueId !== mosqueId);
    data.students = data.students.filter(s => !removedCircleIds.has(s.circleId));
    saveSystemData(data);

    if (circleMosqueFilterId === mosqueId) circleMosqueFilterId = null;
    renderAllDashboard();
    showToast('تم حذف المسجد وحلقاته وطلابه المرتبطين');
}

function renderMosquesCards() {
    const data = getSystemData();
    const container = document.getElementById('mosquesCardsContainer');
    const select = document.getElementById('circleMosqueSelect');
    document.getElementById('homeMosquesBadge').textContent = `${data.mosques.length} مسجد`;

    if (data.mosques.length === 0) {
        container.innerHTML = `
            <div class="empty-state-box">
                <div class="empty-ico">${icon('mosque')}</div>
                <p>لا توجد مجمعات أو مساجد مسجلة بعد</p>
                <button type="button" class="btn-emerald" onclick="openSheet('sheetAddMosque')">إنشاء مسجد جديد</button>
            </div>`;
        select.innerHTML = `<option value="">أضف مسجدا أولا</option>`;
        return;
    }

    container.innerHTML = data.mosques.map(m => {
        const circlesCount = data.circles.filter(c => c.mosqueId === m.id).length;
        return `
            <div class="item-card">
                <div class="item-card-right" onclick="openMosqueCircles('${m.id}')">
                    <div class="mosque-icon-circle">${icon('mosque')}</div>
                    <div>
                        <div class="item-title">${esc(m.name)}</div>
                        <div class="item-subtitle">${circlesCount} حلقة • المشرف: ${esc(m.supervisor)}</div>
                    </div>
                </div>
                <button type="button" class="more-dots-btn" onclick="openMosqueOptions('${m.id}')" aria-label="خيارات المسجد">${icon('more')}</button>
            </div>`;
    }).join('');

    select.innerHTML = data.mosques.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}

/* ==========================================================================
   [4] إدارة الحلقات القرآنية
   ========================================================================== */
function openAddCircleModal() {
    const data = getSystemData();
    if (data.mosques.length === 0) {
        showToast('أضف مسجدا أولا قبل إنشاء الحلقة');
        openSheet('sheetAddMosque');
        return;
    }
    openSheet('sheetAddCircle');
}

function addCircle(event) {
    event.preventDefault();
    const data = getSystemData();
    const mosqueId = document.getElementById('circleMosqueSelect').value;

    if (!mosqueId) {
        showToast('يرجى اختيار المسجد أولا');
        return;
    }

    const newCircle = {
        id: 'crl_' + Date.now(),
        mosqueId: mosqueId,
        name: document.getElementById('circleName').value.trim(),
        teacher: document.getElementById('circleTeacher').value.trim(),
        time: document.getElementById('circleTime')?.value || 'المغرب',
        type: document.getElementById('circleType')?.value || 'حفظ ومراجعة'
    };

    data.circles.push(newCircle);
    saveSystemData(data);

    document.getElementById('circleForm').reset();
    closeSheet('sheetAddCircle');
    renderAllDashboard();
    switchBottomTab('Circles');
    showToast(`تم إنشاء (${newCircle.name}) بنجاح`);
}

function requestDeleteCircle(circleId) {
    const circle = getSystemData().circles.find(c => c.id === circleId);
    if (!circle) return;
    askConfirm('حذف الحلقة', `سيتم حذف (${circle.name}) وطلابها المسجلين فيها. هل تريد المتابعة؟`, () => deleteCircle(circleId));
}

function deleteCircle(circleId) {
    const data = getSystemData();
    data.circles = data.circles.filter(c => c.id !== circleId);
    data.students = data.students.filter(s => s.circleId !== circleId);
    saveSystemData(data);
    renderAllDashboard();
    showToast('تم حذف الحلقة وطلابها المرتبطين بنجاح');
}

function renderCirclesCards() {
    const data = getSystemData();
    const container = document.getElementById('circlesCardsContainer');
    const chipBox = document.getElementById('circlesFilterChip');
    const query = (document.getElementById('circleSearchInput')?.value || '').trim().toLowerCase();

    document.getElementById('circlesCountBadge').textContent = `${data.circles.length} حلقة`;

    // شريحة المسجد المحدد
    if (circleMosqueFilterId) {
        const m = data.mosques.find(x => x.id === circleMosqueFilterId);
        chipBox.innerHTML = m
            ? `<button type="button" class="filter-chip" onclick="clearMosqueFilter()">${esc(m.name)}${icon('x')}</button>`
            : '';
        if (!m) circleMosqueFilterId = null;
    } else {
        chipBox.innerHTML = '';
    }

    let list = data.circles;
    if (circleMosqueFilterId) list = list.filter(c => c.mosqueId === circleMosqueFilterId);

    const filtered = list.filter(c =>
        c.name.toLowerCase().includes(query) || c.teacher.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
        const noCirclesAtAll = data.circles.length === 0;
        container.innerHTML = `
            <div class="empty-state-box">
                <div class="empty-ico">${icon('book')}</div>
                <p>${noCirclesAtAll ? 'لا توجد حلقات بعد' : 'لا توجد حلقات مطابقة للعرض'}</p>
                ${noCirclesAtAll ? `<button type="button" class="btn-emerald" onclick="openAddCircleModal()">إنشاء حلقة جديدة</button>` : ''}
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(c => {
        const mosque = data.mosques.find(m => m.id === c.mosqueId);
        const mosqueName = mosque ? mosque.name : 'غير محدد';
        const studentsCount = data.students.filter(s => s.circleId === c.id).length;

        const studentsUrl = `students.html?circleId=${encodeURIComponent(c.id)}`;

        return `
            <div class="circle-card">
                <div class="circle-card-header">
                    <div style="cursor:pointer;" onclick="window.location.href='${studentsUrl}'">
                        <div class="item-title">${esc(c.name)} <span class="circle-count">(${studentsCount} طالب)</span></div>
                    </div>
                    <button type="button" class="more-dots-btn danger" onclick="requestDeleteCircle('${c.id}')" aria-label="حذف الحلقة">${icon('trash')}</button>
                </div>

                <div class="days-chips">
                    <span class="day-chip">الأحد</span>
                    <span class="day-chip">الاثنين</span>
                    <span class="day-chip">الثلاثاء</span>
                    <span class="day-chip">الأربعاء</span>
                    <span class="day-chip">الخميس</span>
                </div>

                <div class="circle-meta-list" onclick="window.location.href='${studentsUrl}'">
                    <div>التوقيت: <strong>${esc(c.time || 'المغرب')}</strong> • المعلم: <strong>${esc(c.teacher)}</strong></div>
                    <div>المسجد: <strong>${esc(mosqueName)}</strong></div>
                    <div>نوع الحلقة: <strong>${esc(c.type || 'حفظ ومراجعة')}</strong></div>
                </div>
            </div>`;
    }).join('');
}

/* ==========================================================================
   [5] بيانات الجمعية والنسخ الاحتياطي والمستخدم
   ========================================================================== */
function loadAssociationInfo() {
    const data = getSystemData();
    document.getElementById('assocName').value = data.association.name || '';
    document.getElementById('assocManager').value = data.association.manager || '';
    const sub = document.getElementById('assocSubtitle');
    if (sub && data.association.name) {
        sub.textContent = `${data.association.name} (${data.association.manager})`;
    }
}

function saveAssociationInfo(event) {
    event.preventDefault();
    const data = getSystemData();
    data.association.name = document.getElementById('assocName').value.trim();
    data.association.manager = document.getElementById('assocManager').value.trim();
    saveSystemData(data);
    loadAssociationInfo();
    closeSheet('sheetAssociation');
    showToast('تم حفظ بيانات الجمعية بنجاح');
}

function exportBackupJson() {
    const data = getSystemData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rasikh_backup_${data.activeYear.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('تم تنزيل ملف النسخة الاحتياطية');
}

function updateStats() {
    const data = getSystemData();
    document.getElementById('statMosquesCount').textContent = data.mosques.length;
    document.getElementById('statCirclesCount').textContent = data.circles.length;
    document.getElementById('statStudentsCount').textContent = data.students.length;
}

function loadCurrentUser() {
    const userRaw = localStorage.getItem('rasikh_current_user');
    if (!userRaw) return;
    try {
        const user = JSON.parse(userRaw);
        const nameEl = document.getElementById('headerUserName');
        if (nameEl && user.name) nameEl.textContent = user.name;
    } catch (e) {
        /* تجاهل بيانات مستخدم تالفة */
    }
}

function logoutUser() {
    localStorage.removeItem('rasikh_current_user');
    window.location.href = '../index.html';
}

function renderAllDashboard() {
    renderPeriodControls();
    loadAssociationInfo();
    renderMosquesCards();
    renderCirclesCards();
    updateStats();
}

document.addEventListener('DOMContentLoaded', () => {
    renderTodayDate();
    loadCurrentUser();
    renderAllDashboard();
});
