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

function showToast(message) {
    const toast = document.getElementById('rasikhToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

/* ==========================================================================
   [1] التنقل السفلي والقوائم المنبثقة (Bottom Sheets)
   ========================================================================== */
function switchBottomTab(tabName) {
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(btn => btn.classList.remove('active'));

    const targetView = document.getElementById('view' + tabName);
    const targetNav = document.getElementById('nav' + tabName);
    if (targetView) targetView.classList.add('active');
    if (targetNav) targetNav.classList.add('active');
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

/* ==========================================================================
   [2] التاريخ والفترة التشغيلية
   ========================================================================== */
function renderTodayDate() {
    const now = new Date();
    const greg = now.toLocaleDateString('en-GB');
    let hijri = '';
    try {
        hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
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
        .map(year => `<option value="${year}" ${year === data.activeYear ? 'selected' : ''}>${year}</option>`)
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
    document.getElementById('selectedMosqueTitle').textContent = mosque.name + (mosque.district ? ` — ${mosque.district}` : '');
    openSheet('sheetMosqueActions');
}

function filterCirclesBySelectedMosque() {
    closeSheet('sheetMosqueActions');
    switchBottomTab('Circles');
}

function confirmDeleteSelectedMosque() {
    if (!activeMosqueActionId) return;
    const data = getSystemData();
    data.mosques = data.mosques.filter(m => m.id !== activeMosqueActionId);
    data.circles = data.circles.filter(c => c.mosqueId !== activeMosqueActionId);
    saveSystemData(data);

    closeSheet('sheetMosqueActions');
    renderAllDashboard();
    showToast('تم حذف المسجد وحلقاته المرتبطة');
}

function renderMosquesCards() {
    const data = getSystemData();
    const container = document.getElementById('mosquesCardsContainer');
    const select = document.getElementById('circleMosqueSelect');
    document.getElementById('homeMosquesBadge').textContent = `${data.mosques.length} مسجد`;

    if (data.mosques.length === 0) {
        container.innerHTML = `
            <div class="empty-state-box">
                <span class="empty-ico">🕌</span>
                <p>لا توجد مجمعات أو مساجد مسجلة بعد</p>
                <button type="button" class="btn-emerald" style="max-width:210px; margin:0.9rem auto 0;" onclick="openSheet('sheetAddMosque')">+ إنشاء مسجد جديد</button>
            </div>`;
        select.innerHTML = `<option value="">-- أضف مسجداً أولاً --</option>`;
        return;
    }

    container.innerHTML = data.mosques.map(m => {
        const circlesCount = data.circles.filter(c => c.mosqueId === m.id).length;
        return `
            <div class="item-card">
                <div class="item-card-right" onclick="switchBottomTab('Circles')">
                    <div class="mosque-icon-circle">🕌</div>
                    <div>
                        <div class="item-title">${m.name}</div>
                        <div class="item-subtitle">${circlesCount} حلقة • المشرف: ${m.supervisor}</div>
                    </div>
                </div>
                <button type="button" class="more-dots-btn" onclick="openMosqueOptions('${m.id}')">⋮</button>
            </div>`;
    }).join('');

    select.innerHTML = data.mosques.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}

/* ==========================================================================
   [4] إدارة الحلقات القرآنية
   ========================================================================== */
function openAddCircleModal() {
    const data = getSystemData();
    if (data.mosques.length === 0) {
        showToast('أضف مسجداً أولاً قبل إنشاء الحلقة');
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
        showToast('يرجى اختيار المسجد أولاً');
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

function deleteCircle(circleId) {
    const data = getSystemData();
    data.circles = data.circles.filter(c => c.id !== circleId);
    saveSystemData(data);
    renderAllDashboard();
    showToast('تم حذف الحلقة بنجاح');
}

function renderCirclesCards() {
    const data = getSystemData();
    const container = document.getElementById('circlesCardsContainer');
    const query = (document.getElementById('circleSearchInput')?.value || '').trim().toLowerCase();

    const filtered = data.circles.filter(c =>
        c.name.toLowerCase().includes(query) || c.teacher.toLowerCase().includes(query)
    );

    document.getElementById('circlesCountBadge').textContent = `${data.circles.length} حلقة`;

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state-box">
                <span class="empty-ico">📖</span>
                <p>لا توجد حلقات مطابقة للعرض حالياً</p>
                <button type="button" class="btn-emerald" style="max-width:210px; margin:0.9rem auto 0;" onclick="openAddCircleModal()">+ إنشاء حلقة جديدة</button>
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(c => {
        const mosque = data.mosques.find(m => m.id === c.mosqueId);
        const mosqueName = mosque ? mosque.name : 'غير محدد';
        const studentsCount = data.students.filter(s => s.circleId === c.id).length;

        return `
            <div class="circle-card">
                <div class="circle-card-header">
                    <div style="cursor:pointer;" onclick="window.location.href='students.html'">
                        <div class="item-title">${c.name} <span style="font-size:0.8rem; color:var(--text-muted); font-weight:600;">(${studentsCount} طالب)</span></div>
                    </div>
                    <button type="button" class="more-dots-btn" style="color:#DC2626;" onclick="deleteCircle('${c.id}')" title="حذف الحلقة">🗑️</button>
                </div>

                <div class="days-chips">
                    <span class="day-chip">الأحد</span>
                    <span class="day-chip">الاثنين</span>
                    <span class="day-chip">الثلاثاء</span>
                    <span class="day-chip">الأربعاء</span>
                    <span class="day-chip">الخميس</span>
                </div>

                <div class="circle-meta-list" onclick="window.location.href='students.html'" style="cursor:pointer;">
                    <div>التوقيت: <strong>${c.time || 'المغرب'}</strong> • المعلم: <strong>${c.teacher}</strong></div>
                    <div>المسجد: <strong>${mosqueName}</strong></div>
                    <div>نوع الحلقة: <strong>${c.type || 'حفظ ومراجعة'}</strong></div>
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
    if (userRaw) {
        const user = JSON.parse(userRaw);
        const nameEl = document.getElementById('headerUserName');
        if (nameEl && user.name) nameEl.textContent = user.name;
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
