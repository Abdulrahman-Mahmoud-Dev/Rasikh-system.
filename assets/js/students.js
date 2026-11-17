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

function getSystemData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {
        years: ['1447 هـ', '1448 هـ'],
        activeYear: '1448 هـ',
        activeMonth: 'محرم',
        association: { name: '', manager: '' },
        mosques: [],
        circles: [],
        students: []
    };
}

function saveSystemData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getCurrentPeriodKey(data) {
    return `${data.activeYear}_${data.activeMonth}`;
}

function getDateKey(dateObj) {
    return dateObj.toISOString().split('T')[0];
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

    if (data.circles.length === 0) {
        addSelect.innerHTML = `<option value="">-- أضف حلقة من الرئيسية أولاً --</option>`;
        filterSelect.innerHTML = `<option value="all">جميع الحلقات</option>`;
    } else {
        const optionsHtml = data.circles.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        addSelect.innerHTML = optionsHtml;
        filterSelect.innerHTML = `<option value="all">جميع الحلقات</option>` + optionsHtml;
    }

    const surahsHtml = SURAHS_LIST.map(s => `<option value="${s}">${s}</option>`).join('');
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

function deleteActiveStudent() {
    if (!activeEvalStudentId) return;
    const data = getSystemData();
    data.students = data.students.filter(s => s.id !== activeEvalStudentId);
    saveSystemData(data);

    closeSheet('sheetEvaluateStudent');
    renderStudentsCards();
    showToast('تم حذف الطالب من الحلقة');
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
    const selectedCircle = document.getElementById('filterCircleSelect').value;

    data.students.forEach(s => {
        if (selectedCircle !== 'all' && s.circleId !== selectedCircle) return;
        if (!s.dailyLogs) s.dailyLogs = {};
        if (!s.dailyLogs[dateKey]) {
            s.dailyLogs[dateKey] = { status: 'حاضر', evaluated: false, memPages: 0, revPages: 0, tilawaPages: 0 };
        } else {
            s.dailyLogs[dateKey].status = 'حاضر';
        }
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
                    <div class="student-avatar-circle">${firstLetter}</div>
                    <div>
                        <div class="item-title" style="font-size:0.95rem;">${s.name}</div>
                        <div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-top:0.3rem;">
                            <span class="badge-tag ${statusClass}">${dayLog.status}</span>
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
function openStudentEvaluation(studentId) {
    const data = getSystemData();
    const student = data.students.find(s => s.id === studentId);
    if (!student) return;

    activeEvalStudentId = studentId;
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
    activeEvalTrack = trackName;
    document.querySelectorAll('.eval-type-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
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
    const prevDay = student.dailyLogs[dateKey] || { memPages: 0, revPages: 0, tilawaPages: 0 };

    const addedPages = isAbsent ? 0 : (parseFloat(document.getElementById('evalPagesInput').value) || 0);
    const tajweedErr = parseInt(document.getElementById('tajweedErrors').textContent, 10) || 0;
    const readingErr = parseInt(document.getElementById('readingErrors').textContent, 10) || 0;

    let memPages = prevDay.memPages || 0;
    let revPages = prevDay.revPages || 0;
    let tilawaPages = prevDay.tilawaPages || 0;

    if (!isAbsent) {
        if (activeEvalTrack === 'حفظ') memPages = addedPages;
        else if (activeEvalTrack === 'مراجعة صغرى') revPages = addedPages;
        else tilawaPages = addedPages;
    }

    student.dailyLogs[dateKey] = {
        status: status,
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

    // تحديث السجل الشهري الموحد تلقائياً ليتزامن مع صفحة التقارير
    if (!student.records) student.records = {};
    if (!student.records[periodKey]) {
        student.records[periodKey] = { attendance: 0, memPages: 0, revPages: 0, grade: 'ممتاز' };
    }

    let totalAtt = 0, totalMem = 0, totalRev = 0;
    Object.values(student.dailyLogs).forEach(log => {
        if (log.status === 'حاضر' || log.status === 'متأخر') totalAtt += 1;
        totalMem += (log.memPages || 0);
        totalRev += (log.revPages || 0) + (log.tilawaPages || 0);
    });

    const totalErrors = tajweedErr + readingErr;
    const computedGrade = totalErrors === 0 ? 'ممتاز' : (totalErrors <= 2 ? 'جيد جداً' : 'جيد');

    student.records[periodKey] = {
        attendance: totalAtt,
        memPages: totalMem,
        revPages: totalRev,
        grade: computedGrade
    };

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
