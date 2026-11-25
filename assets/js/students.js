const STORAGE_KEY = 'rasikh_system_data_v1';

const SURAHS_LIST = [
    "الفاتحة","البقرة","آل عمران","النساء","المائدة","الأنعام","الأعراف","الأنفال","التوبة","يونس",
    "هود","يوسف","الرعد","إبراهيم","الحجر","النحل","الإسراء","الكهف","مريم","طه",
    "الأنبياء","الحج","المؤمنون","النور","الفرقان","الشعراء","النمل","القصص","العنكبوت","الروم",
    "لقمان","السجدة","الأحزاب","سبأ","فاطر","يس","الصافات","ص","الزمر","غافر",
    "فصلت","الشورى","الزخرف","الدخان","الجاثية","الأحقاف","محمد","الفتح","الحجرات","ق",
    "الذاريات","الطور","النجم","القمر","الرحمن","الواقعة","الحديد","المجادلة","الحشر","الممتحنة",
    "الصف","الجمعة","المنافقون","التغابن","الطلاق","التحريم","الملك","القلم","الحاقة","المعارج",
    "نوح","الجن","المزمل","المدثر","القيامة","الإنسان","المرسلات","النبأ","النازعات","عبس",
    "التكوير","الانفطار","المطففين","الانشقاق","البروج","الطارق","الأعلى","الغاشية","الفجر","البلد",
    "الشمس","الليل","الضحى","الشرح","التين","العلق","القدر","البينة","الزلزلة","العاديات",
    "القارعة","التكاثر","العصر","الهمزة","الفيل","قريش","الماعون","الكوثر","الكافرون","النصر",
    "المسد","الإخلاص","الفلق","الناس"
];

let selectedDateObj = new Date();
let currentStatusFilter = 'all';
let activeEvalStudentId = null;
let activeEvalTrack = 'حفظ';

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function getSystemData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
        return {
            years: ['1447 هـ', '1448 هـ'],
            activeYear: '1448 هـ',
            activeMonth: 'محرم',
            association: { name: '', manager: '' },
            mosques: [],
            circles: [],
            students: []
        };
    }
    try {
        return JSON.parse(saved);
    } catch (e) {
        return {
            years: ['1447 هـ', '1448 هـ'],
            activeYear: '1448 هـ',
            activeMonth: 'محرم',
            association: { name: '', manager: '' },
            mosques: [],
            circles: [],
            students: []
        };
    }
}

function saveSystemData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getCurrentPeriodKey(data) {
    return `${data.activeYear}_${data.activeMonth}`;
}

function getDateKey(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function syncStudentMonthlyRecord(student, periodKey) {
    if (!student.records) student.records = {};
    if (!student.dailyLogs) student.dailyLogs = {};

    let totalAtt = 0;
    let totalMem = 0;
    let totalRev = 0;
    let totalErrors = 0;
    let evalCount = 0;

    Object.values(student.dailyLogs).forEach(log => {
        if (log.periodKey && log.periodKey !== periodKey) return;
        if (log.status === 'حاضر' || log.status === 'متأخر') totalAtt += 1;
        totalMem += Number(log.memPages) || 0;
        totalRev += (Number(log.revPages) || 0) + (Number(log.tilawaPages) || 0);
        if (log.evaluated) {
            totalErrors += (Number(log.tajweedErrors) || 0) + (Number(log.readingErrors) || 0);
            evalCount += 1;
        }
    });

    const avgErrors = evalCount > 0 ? (totalErrors / evalCount) : 0;
    const computedGrade = avgErrors === 0 ? 'ممتاز' : (avgErrors <= 2 ? 'جيد جداً' : 'جيد');

    student.records[periodKey] = {
        attendance: totalAtt,
        memPages: totalMem,
        revPages: totalRev,
        grade: computedGrade
    };
}

function showToast(message) {
    const toast = document.getElementById('rasikhToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

/* ==========================================================================
   [1] التاريخ اليومي والقوائم المنسدلة
   ========================================================================== */
function renderDateHeader() {
    const daysAr = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const dayName = daysAr[selectedDateObj.getDay()];
    const dayNum = String(selectedDateObj.getDate()).padStart(2, '0');
    const monthNum = String(selectedDateObj.getMonth() + 1).padStart(2, '0');
    document.getElementById('selectedDateDisplay').textContent = `${dayName}, ${dayNum}/${monthNum}`;
}

function shiftSelectedDate(deltaDays) {
    selectedDateObj.setDate(selectedDateObj.getDate() + deltaDays);
    renderDateHeader();
    renderStudentsCards();
}

function populateDropdowns() {
    const data = getSystemData();
    const addSelect = document.getElementById('studentCircleSelect');
    const filterSelect = document.getElementById('filterCircleSelect');
    const requestedCircleId = new URLSearchParams(window.location.search).get('circleId');

    if (data.circles.length === 0) {
        addSelect.innerHTML = `<option value="">-- أضف حلقة من الرئيسية أولاً --</option>`;
        filterSelect.innerHTML = `<option value="all">جميع الحلقات</option>`;
    } else {
        const optionsHtml = data.circles.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
        addSelect.innerHTML = optionsHtml;
        filterSelect.innerHTML = `<option value="all">جميع الحلقات</option>` + optionsHtml;

        if (requestedCircleId && data.circles.some(c => c.id === requestedCircleId)) {
            filterSelect.value = requestedCircleId;
            addSelect.value = requestedCircleId;
        }
    }

    const surahsHtml = SURAHS_LIST.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    document.getElementById('evalFromSurah').innerHTML = surahsHtml;
    document.getElementById('evalToSurah').innerHTML = surahsHtml;
}

function openAddStudentSheet() {
    const data = getSystemData();
    if (data.circles.length === 0) {
        showToast('أنشئ حلقة من الرئيسية أولاً قبل تسجيل الطلاب');
        return;
    }
    document.getElementById('sheetAddStudent').classList.add('open');
}

function closeSheet(id) {
    document.getElementById(id)?.classList.remove('open');
}

function closeSheetOnBackdrop(event, id) {
    if (event.target.id === id) closeSheet(id);
}

/* ==========================================================================
   [2] إضافة طالب وحذف طالب
   ========================================================================== */
function addStudent(event) {
    event.preventDefault();
    const data = getSystemData();
    const circleId = document.getElementById('studentCircleSelect').value;
    if (!circleId) return;

    const newStudent = {
        id: 'std_' + Date.now(),
        circleId: circleId,
        name: document.getElementById('studentName').value.trim(),
        prevJuz: parseInt(document.getElementById('studentPrevJuz').value, 10) || 0,
        guardianPhone: document.getElementById('guardianPhone').value.trim(),
        records: {},
        dailyLogs: {}
    };

    data.students.push(newStudent);
    saveSystemData(data);

    document.getElementById('studentForm').reset();
    closeSheet('sheetAddStudent');
    renderStudentsCards();
    showToast(`تم تسجيل الطالب (${newStudent.name})`);
}

function requestDeleteActiveStudent() {
    if (!activeEvalStudentId) return;
    const data = getSystemData();
    const student = data.students.find(s => s.id === activeEvalStudentId);
    if (!student) return;

    const textEl = document.getElementById('confirmDeleteStudentText');
    if (textEl) {
        textEl.textContent = `سيتم حذف الطالب (${student.name}) وجميع سجلات حضوره وتقييمه. هل تريد المتابعة؟`;
    }
    closeSheet('sheetEvaluateStudent');
    document.getElementById('sheetConfirmDeleteStudent')?.classList.add('open');
}

function confirmDeleteActiveStudent() {
    if (!activeEvalStudentId) return;
    const data = getSystemData();
    data.students = data.students.filter(s => s.id !== activeEvalStudentId);
    saveSystemData(data);

    activeEvalStudentId = null;
    closeSheet('sheetConfirmDeleteStudent');
    renderStudentsCards();
    showToast('تم حذف الطالب من الحلقة');
}

function deleteActiveStudent() {
    requestDeleteActiveStudent();
}

/* ==========================================================================
   [3] الفلاتر والإجراء الجماعي وبطاقات الطلاب
   ========================================================================== */
function setStatusFilter(status, btnEl) {
    currentStatusFilter = status;
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
    renderStudentsCards();
}

function markAllPresentToday() {
    const data = getSystemData();
    const dateKey = getDateKey(selectedDateObj);
    const periodKey = getCurrentPeriodKey(data);
    const selectedCircle = document.getElementById('filterCircleSelect').value;

    data.students.forEach(s => {
        if (selectedCircle !== 'all' && s.circleId !== selectedCircle) return;
        if (!s.dailyLogs) s.dailyLogs = {};
        if (!s.dailyLogs[dateKey]) {
            s.dailyLogs[dateKey] = {
                status: 'حاضر',
                periodKey: periodKey,
                evaluated: false,
                memPages: 0,
                revPages: 0,
                tilawaPages: 0
            };
        } else {
            s.dailyLogs[dateKey].status = 'حاضر';
            s.dailyLogs[dateKey].periodKey = periodKey;
        }
        syncStudentMonthlyRecord(s, periodKey);
    });

    saveSystemData(data);
    renderStudentsCards();
    showToast('تم تحضير جميع طلاب القائمة لليوم');
}

function renderStudentsCards() {
    const data = getSystemData();
    const dateKey = getDateKey(selectedDateObj);
    const selectedCircle = document.getElementById('filterCircleSelect').value;
    const searchQuery = (document.getElementById('studentSearchInput')?.value || '').trim().toLowerCase();
    const container = document.getElementById('studentsCardsContainer');

    const circleObj = data.circles.find(c => c.id === selectedCircle);
    document.getElementById('activeCircleHeaderTitle').textContent = circleObj ? circleObj.name : 'جميع الحلقات';

    let list = data.students.filter(s => {
        const matchCircle = selectedCircle === 'all' || s.circleId === selectedCircle;
        const matchSearch = s.name.toLowerCase().includes(searchQuery);
        const dayLog = (s.dailyLogs && s.dailyLogs[dateKey]) ? s.dailyLogs[dateKey] : { status: 'حاضر', evaluated: false };
        const matchStatus = currentStatusFilter === 'all' || dayLog.status === currentStatusFilter;
        return matchCircle && matchSearch && matchStatus;
    });

    document.getElementById('studentsTotalCount').textContent = `(${list.length})`;

    if (list.length === 0) {
        container.innerHTML = `
            <div class="empty-state-box">
                <span class="empty-ico">👨‍🎓</span>
                <p>لا يوجد طلاب مطابقون للعرض حالياً</p>
                <button type="button" class="btn-emerald" style="max-width:200px; margin:0.9rem auto 0;" onclick="openAddStudentSheet()">+ أضف طالب جديد</button>
            </div>`;
        return;
    }

    container.innerHTML = list.map(s => {
        const dayLog = (s.dailyLogs && s.dailyLogs[dateKey])
            ? s.dailyLogs[dateKey]
            : { status: 'حاضر', evaluated: false };

        const firstLetter = s.name.charAt(0) || 'ط';
        const isAbsentLike = ['غائب', 'غائب بعذر', 'استئذان'].includes(dayLog.status);

        let statusClass = 'tag-present';
        if (dayLog.status === 'غائب') statusClass = 'tag-absent';
        else if (dayLog.status === 'غائب بعذر' || dayLog.status === 'استئذان') statusClass = 'tag-excused';
        else if (dayLog.status === 'متأخر') statusClass = 'tag-late';

        const evalBadge = isAbsentLike
            ? ''
            : (dayLog.evaluated
                ? `<span class="badge-tag tag-eval-done">✓ تم التقييم</span>`
                : `<span class="badge-tag tag-eval-wait">ⓘ لم يكتمل التقييم بعد</span>`);

        return `
            <div class="student-card ${!dayLog.evaluated && !isAbsentLike ? 'pending-eval' : ''}" onclick="openStudentEvaluation('${s.id}')" style="cursor:pointer;">
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <div class="student-avatar-circle">${esc(firstLetter)}</div>
                    <div>
                        <div class="item-title" style="font-size:0.95rem;">${esc(s.name)}</div>
                        <div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-top:0.3rem;">
                            <span class="badge-tag ${statusClass}">${esc(dayLog.status)}</span>
                            ${evalBadge}
                        </div>
                    </div>
                </div>
                <span style="color:var(--text-muted); font-weight:800; font-size:1.1rem;">⋮</span>
            </div>`;
    }).join('');
}

/* ==========================================================================
   [4] شاشة تقييم الطالب اليومي وربطها بالسجل الشهري
   ========================================================================== */
function getTrackSavedPages(dayLog, trackName) {
    if (!dayLog) return 1;
    if (trackName === 'حفظ') return dayLog.memPages ?? 1;
    if (trackName === 'مراجعة صغرى') return dayLog.revPages ?? 0;
    return dayLog.tilawaPages ?? 0;
}

function openStudentEvaluation(studentId) {
    const data = getSystemData();
    const student = data.students.find(s => s.id === studentId);
    if (!student) return;

    activeEvalStudentId = studentId;
    activeEvalTrack = 'حفظ';
    const dateKey = getDateKey(selectedDateObj);
    const dayLog = (student.dailyLogs && student.dailyLogs[dateKey])
        ? student.dailyLogs[dateKey]
        : { status: 'حاضر', evaluated: false, memPages: 0, revPages: 0, tilawaPages: 0, tajweedErrors: 0, readingErrors: 0 };

    document.getElementById('evalStudentTitle').textContent = student.name;
    document.getElementById('evalStatusSelect').value = dayLog.status || 'حاضر';
    document.getElementById('sumMemPages').textContent = dayLog.memPages || 0;
    document.getElementById('sumRevPages').textContent = dayLog.revPages || 0;
    document.getElementById('sumTilawaPages').textContent = dayLog.tilawaPages || 0;
    document.getElementById('tajweedErrors').textContent = dayLog.tajweedErrors || 0;
    document.getElementById('readingErrors').textContent = dayLog.readingErrors || 0;

    if (dayLog.fromSurah) document.getElementById('evalFromSurah').value = dayLog.fromSurah;
    if (dayLog.fromAyah) document.getElementById('evalFromAyah').value = dayLog.fromAyah;
    if (dayLog.toSurah) document.getElementById('evalToSurah').value = dayLog.toSurah;
    if (dayLog.toAyah) document.getElementById('evalToAyah').value = dayLog.toAyah;

    document.querySelectorAll('.eval-type-btn').forEach((btn, idx) => {
        btn.classList.toggle('active', idx === 0);
    });
    document.getElementById('evalPagesInput').value = dayLog.evaluated ? (dayLog.memPages || 0) : 1;

    // تجهيز رابط واتساب لولي الأمر
    const rawPhone = (student.guardianPhone || '').replace(/\D/g, '');
    const intlPhone = rawPhone.startsWith('05') ? '966' + rawPhone.slice(1) : rawPhone;
    const waMsg = encodeURIComponent(`السلام عليكم ورحمة الله وبركاته، ولي أمر الطالب (${student.name})، نود إفادتكم بحالة الطالب اليوم في الحلقة.`);
    document.getElementById('whatsappGuardianLink').href = intlPhone ? `https://wa.me/${intlPhone}?text=${waMsg}` : `https://wa.me/?text=${waMsg}`;

    onEvalStatusChange();
    document.getElementById('sheetEvaluateStudent').classList.add('open');
}

function onEvalStatusChange() {
    const status = document.getElementById('evalStatusSelect').value;
    const isAbsent = ['غائب', 'غائب بعذر', 'استئذان'].includes(status);

    document.getElementById('evalRecitationArea').style.display = isAbsent ? 'none' : 'block';
    document.getElementById('evalAbsentArea').style.display = isAbsent ? 'block' : 'none';
    document.getElementById('absentStatusText').textContent = status;
}

function selectEvalTrack(trackName, btnEl) {
    // حفظ القيمة الحالية في ملخص الشريط قبل التبديل
    const currentVal = parseFloat(document.getElementById('evalPagesInput').value) || 0;
    if (activeEvalTrack === 'حفظ') document.getElementById('sumMemPages').textContent = currentVal;
    else if (activeEvalTrack === 'مراجعة صغرى') document.getElementById('sumRevPages').textContent = currentVal;
    else document.getElementById('sumTilawaPages').textContent = currentVal;

    activeEvalTrack = trackName;
    document.querySelectorAll('.eval-type-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');

    let nextVal = 0;
    if (trackName === 'حفظ') nextVal = parseFloat(document.getElementById('sumMemPages').textContent) || 0;
    else if (trackName === 'مراجعة صغرى') nextVal = parseFloat(document.getElementById('sumRevPages').textContent) || 0;
    else nextVal = parseFloat(document.getElementById('sumTilawaPages').textContent) || 0;

    document.getElementById('evalPagesInput').value = nextVal;
}

function adjustErrorCount(elementId, delta) {
    const el = document.getElementById(elementId);
    const current = parseInt(el.textContent, 10) || 0;
    el.textContent = Math.max(0, current + delta);
}

function saveDailyEvaluation() {
    const data = getSystemData();
    const student = data.students.find(s => s.id === activeEvalStudentId);
    if (!student) return;

    const dateKey = getDateKey(selectedDateObj);
    const periodKey = getCurrentPeriodKey(data);
    const status = document.getElementById('evalStatusSelect').value;
    const isAbsent = ['غائب', 'غائب بعذر', 'استئذان'].includes(status);

    if (!student.dailyLogs) student.dailyLogs = {};

    const addedPages = isAbsent ? 0 : (parseFloat(document.getElementById('evalPagesInput').value) || 0);
    const tajweedErr = parseInt(document.getElementById('tajweedErrors').textContent, 10) || 0;
    const readingErr = parseInt(document.getElementById('readingErrors').textContent, 10) || 0;

    let memPages = isAbsent ? 0 : (parseFloat(document.getElementById('sumMemPages').textContent) || 0);
    let revPages = isAbsent ? 0 : (parseFloat(document.getElementById('sumRevPages').textContent) || 0);
    let tilawaPages = isAbsent ? 0 : (parseFloat(document.getElementById('sumTilawaPages').textContent) || 0);

    if (!isAbsent) {
        if (activeEvalTrack === 'حفظ') memPages = addedPages;
        else if (activeEvalTrack === 'مراجعة صغرى') revPages = addedPages;
        else tilawaPages = addedPages;
    }

    student.dailyLogs[dateKey] = {
        status: status,
        periodKey: periodKey,
        evaluated: !isAbsent,
        memPages: memPages,
        revPages: revPages,
        tilawaPages: tilawaPages,
        fromSurah: document.getElementById('evalFromSurah').value,
        fromAyah: document.getElementById('evalFromAyah').value,
        toSurah: document.getElementById('evalToSurah').value,
        toAyah: document.getElementById('evalToAyah').value,
        tajweedErrors: tajweedErr,
        readingErrors: readingErr
    };

    syncStudentMonthlyRecord(student, periodKey);

    saveSystemData(data);
    closeSheet('sheetEvaluateStudent');
    renderStudentsCards();
    showToast(`تم حفظ تقييم (${student.name}) بنجاح`);
}

document.addEventListener('DOMContentLoaded', () => {
    renderDateHeader();
    populateDropdowns();
    renderStudentsCards();
});
