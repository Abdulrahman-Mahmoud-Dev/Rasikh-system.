(()=>{
"use strict";
const API=(window.RASIKH_CONFIG&&window.RASIKH_CONFIG.API_BASE_URL||"").replace(/\/$/,"");
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={user:null,assignments:[],permissions:[],roles:[],associationId:"",hierarchy:[],students:[],attendance:{},report:null,invitationToken:null,invitationInfo:null,resetToken:null,authMode:"login",circleOnlyMode:false,activeCircleId:null,activeAssignedWorkspace:null};
const labels={after_fajr:"بعد الفجر",after_dhuhr:"بعد الظهر",after_asr:"بعد العصر",after_maghrib:"بعد المغرب",after_isha:"بعد العشاء",active:"نشط",temporarily_suspended:"موقوف مؤقتًا",expelled:"مستبعد",mosque:"مسجد",quranic_center:"مقر قرآني"};
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),3200)}
function msg(el,text,isError=true){el.textContent=text;el.style.color=isError?"#b4232e":"#176b54"}
async function api(path,opts={}){if(!API)throw Error("لم يتم ضبط عنوان API في assets/js/rasikh-config.js.");const res=await fetch(API+"/api/v1"+path,{...opts,credentials:"include",headers:{"Content-Type":"application/json",...(opts.headers||{})}});let data={};try{data=await res.json()}catch{}if(!res.ok)throw Error(data?.error?.message||"تعذر تنفيذ الطلب ("+res.status+")");return data}
function showApp(){
 $("#loginView").classList.add("hidden");$("#onboardingView").classList.add("hidden");$("#assignmentSelectView").classList.add("hidden");$("#appView").classList.remove("hidden");
 $("#sideUserName").textContent=state.user.fullName;$("#userInitial").textContent=(state.user.fullName||"ر").trim()[0];
 $("#accountDetails").textContent=state.user.fullName+" · "+(state.user.fileNumber||"");
 $("#welcomeTitle").textContent="مرحبًا بك، "+state.user.fullName;
 $("#todayLabel").textContent=new Intl.DateTimeFormat("ar-SA-u-ca-islamic",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());
 renderNavigation();
}
function hasPermission(permission){return state.permissions.includes(permission)}
function hasAnyPermission(items){return items.some(hasPermission)}
function roleSet(){return new Set(state.roles)}
function refreshPermissions(){
 const current=state.assignments.filter(a=>a.association_id===state.associationId);
 state.roles=[...new Set(current.map(a=>a.role_code))];
 state.permissions=[...new Set(current.flatMap(a=>Array.isArray(a.granted_permissions)?a.granted_permissions:[]))];
}
function renderNavigation(){
 const roles=roleSet(),guardian=roles.size>0&&[...roles].every(r=>r==="guardian");
 const teaching=roles.has("teacher")||roles.has("circle_assistant");
 const supervisory=roles.has("supervisor")||roles.has("supervisor_deputy");
 const canStructure=hasAnyPermission(["premises:read","premises:create","circles:read","circles:create"]);
 const canStudents=hasPermission("students:read");
 const canAttendance=hasAnyPermission(["attendance:record","attendance:update","recitations:record","recitations:update"]);
 const canReports=hasPermission("reports:read");
 const canSettings=hasAnyPermission(["settings:manage","evaluations:manage"]);
 const canAdd=hasAnyPermission(["premises:create","circles:create","students:create","people:create","invitations:create","roles:assign"]);
 const allowed={home:!state.circleOnlyMode,structure:canStructure,students:canStudents,attendance:canAttendance,reports:canReports,settings:canSettings};
 $$("#sideNav [data-view]").forEach(b=>b.classList.toggle("hidden",!allowed[b.dataset.view]));
 const sideStructure=$("#sideNav [data-view=structure]");
 if(sideStructure)sideStructure.lastChild.textContent=teaching?"حلقاتي":supervisory?"المساجد والمقرات":"الهيكل التنظيمي";
 const sideStudents=$("#sideNav [data-view=students]");
 if(sideStudents)sideStudents.lastChild.textContent=guardian?"أبنائي":"الطلاب";
 const mobileAllowed={home:!guardian&&!state.circleOnlyMode,structure:canStructure,students:canStudents,attendance:canAttendance};
 $$(".mobile-bottom-nav [data-view]").forEach(b=>{
  const v=b.dataset.view;b.classList.toggle("hidden",!mobileAllowed[v]);
  if(v==="home")b.lastChild.textContent=teaching?"اليوم":"الرئيسية";
  if(v==="structure")b.lastChild.textContent=teaching?"حلقاتي":supervisory?"المساجد":"الهيكل";
  if(v==="students")b.lastChild.textContent=guardian?"أبنائي":"الطلاب";
 });
 $("#mobileAdd").classList.toggle("hidden",!canAdd);
 $("#mobileMore").classList.remove("hidden");
 $("#mobileMenu").classList.toggle("hidden",!canStructure&&!canStudents&&!canAttendance&&!canReports&&!canSettings);
 if($("#addPremiseBtn"))$("#addPremiseBtn").classList.toggle("hidden",!hasPermission("premises:create"));
 if($("#inviteMemberBtn"))$("#inviteMemberBtn").classList.toggle("hidden",!hasPermission("invitations:create"));
 if($("#addStudentBtn"))$("#addStudentBtn").classList.toggle("hidden",!hasPermission("students:create"));
 if($("#circleForm"))$("#circleForm").classList.toggle("hidden",!hasPermission("circles:create"));
 const first=state.assignments.find(a=>a.association_id===state.associationId);
 const roleLabels={association_manager:"مدير جمعية",association_deputy:"نائب مدير الجمعية",branch_manager:"مدير فرع",branch_deputy:"نائب مدير الفرع",supervisor:"مشرف",supervisor_deputy:"مساعد مشرف",teacher:"معلم",circle_assistant:"مساعد حلقة",guardian:"ولي أمر"};
 $("#sideUserRole").textContent=state.user.platformRole?"إدارة النظام":(roleLabels[first?.role_code]||"عضو راسخ");
}
function setAuthMode(mode){
 state.authMode=mode;
 $("#tabLogin").classList.toggle("active",mode==="login");$("#tabRegister").classList.toggle("active",mode==="register");
 $("#passwordLoginForm").classList.toggle("hidden",mode!=="login");$("#registerForm").classList.toggle("hidden",mode!=="register");
 $("#invitationRegisterForm").classList.add("hidden");$("#resetRequestForm").classList.add("hidden");$("#resetConfirmForm").classList.add("hidden");
 $("#tabLogin").classList.remove("hidden");$("#tabRegister").classList.remove("hidden");
 $("#authTitle").textContent=mode==="login"?"تسجيل الدخول":"إنشاء حساب جديد";
 $("#authDescription").textContent=mode==="login"?"ادخل إلى حسابك لمتابعة أعمالك وحلقاتك.":"أنشئ حسابك بالبريد الإلكتروني وكلمة المرور، ثم أكد بريدك مرة واحدة.";
 $("#authMessage").textContent="";
}
async function loadMe(){
 const data=await api("/auth/me");state.user=data.user;state.assignments=data.assignments||[];
 const unique=new Map();state.assignments.forEach(a=>unique.set(a.association_id,{id:a.association_id,name:a.association_name}));
 const opts=[...unique.values()];
 $("#associationSelect").innerHTML=opts.map(a=>'<option value="'+a.id+'">'+esc(a.name)+'</option>').join("")||'<option value="">لا توجد جهة مرتبطة</option>';
 state.associationId=opts[0]?.id||"";refreshPermissions();
}
function getAssignedCircleChoices(){
 const map=new Map();
 for(const item of state.assignments){
  if(!["teacher","circle_assistant"].includes(item.role_code)||item.scope_type!=="circle")continue;
  const circleId=item.assigned_circle_id||item.circle_id;
  if(!circleId)continue;
  const key=item.association_id+"|"+circleId;
  const old=map.get(key)||{
   association_id:item.association_id,
   association_name:item.association_name||"جهة مستقلة",
   workspace_kind:item.workspace_kind||"",
   branch_name:item.assigned_branch_name||"",
   premise_id:item.assigned_premise_id||item.quranic_premise_id||"",
   premise_name:item.assigned_premise_name||"المسجد أو المقر",
   circle_id:circleId,
   circle_name:item.assigned_circle_name||"الحلقة",
   study_period:item.assigned_circle_period||"",
   roles:[]
  };
  if(!old.roles.includes(item.role_code))old.roles.push(item.role_code);
  map.set(key,old);
 }
 return [...map.values()].sort((a,b)=>
  a.association_name.localeCompare(b.association_name,"ar")||
  a.branch_name.localeCompare(b.branch_name,"ar")||
  a.premise_name.localeCompare(b.premise_name,"ar")||
  a.circle_name.localeCompare(b.circle_name,"ar")
 );
}
function isCircleStaffOnly(){
 const roles=state.assignments.map(a=>a.role_code).filter(Boolean);
 return roles.length>0&&roles.every(role=>role==="teacher"||role==="circle_assistant");
}
function showAssignedCircleChooser(choices){
 $("#loginView").classList.add("hidden");$("#onboardingView").classList.add("hidden");$("#appView").classList.add("hidden");
 $("#assignedContext").classList.add("hidden");$("#changeAssignedCircle").classList.add("hidden");
 $("#assignmentSelectView").classList.remove("hidden");
 $("#assignmentSelectMessage").textContent=choices.length?"اختر الحلقة التي تريد العمل عليها.":"لم يتم إسناد حلقة إلى حسابك حتى الآن. تواصل مع المشرف المسؤول.";
 $("#assignedCircleOptions").innerHTML=choices.map((item,index)=>
  '<button type="button" class="assignment-option" data-assigned-index="'+index+'">'+
   '<span class="assignment-number">'+(index+1).toLocaleString("ar-SA")+'</span>'+
   '<strong>'+esc(item.circle_name)+'</strong>'+
   '<span>'+esc(item.association_name)+'</span>'+
   '<small>'+esc(item.premise_name)+(item.branch_name?" · "+esc(item.branch_name):"")+'</small>'+
   '<small>'+(item.roles.map(x=>x==="teacher"?"معلم":"مساعد حلقة").join("، "))+'</small>'+
  '</button>'
 ).join("");
 state.availableAssignedChoices=choices;
}
async function enterAssignedCircle(choice){
 state.circleOnlyMode=true;
 state.activeCircleId=choice.circle_id;
 state.activeAssignedWorkspace=choice;
 state.associationId=choice.association_id;
 showApp();
 $("#associationSelect").classList.add("hidden");
 $("#assignedContext").textContent=choice.premise_name+" · "+choice.circle_name;
 $("#assignedContext").classList.remove("hidden");
 $("#changeAssignedCircle").classList.remove("hidden");
 await loadCurrentAssociation();
 $("#attendanceCircle").value=choice.circle_id;
 $("#studentCircleFilter").value=choice.circle_id;
 $("#reportCircle").value=choice.circle_id;
 $("#attendanceCircle").disabled=true;
 $("#studentCircleFilter").disabled=true;
 $("#reportCircle").disabled=true;
 nav("attendance");
}
async function routeAuthenticatedUser(){
 await loadMe();
 if(isCircleStaffOnly()){
  const choices=getAssignedCircleChoices();
  if(choices.length===1){await enterAssignedCircle(choices[0]);return;}
  showAssignedCircleChooser(choices);return;
 }
 state.circleOnlyMode=false;state.activeCircleId=null;state.activeAssignedWorkspace=null;
 $("#associationSelect").classList.remove("hidden");$("#assignedContext").classList.add("hidden");$("#changeAssignedCircle").classList.add("hidden");
 if(!state.assignments.length){await showOnboarding();return;}
 showApp();
 const landing=state.roles.every(r=>r==="guardian")?"students":"home";
 nav(landing);await loadCurrentAssociation();
}
async function afterAuthenticated(){await routeAuthenticatedUser();}
async function acceptPendingInvitation(){
 if(!state.invitationToken)return;
 await api("/invitations/accept",{method:"POST",body:JSON.stringify({token:state.invitationToken})});
 state.invitationToken=null;const url=new URL(location.href);url.searchParams.delete("invitation");history.replaceState({}, "",url.toString());
}
async function loadCurrentAssociation(){refreshPermissions();renderNavigation();if(!state.associationId){renderHome();return}$("#associationSelect").value=state.associationId;await Promise.all([loadHierarchy(),loadStudents()]);renderHome()}
async function loadHierarchy(){
 const params=new URLSearchParams();
 if(state.circleOnlyMode&&state.activeCircleId)params.set("circleId",state.activeCircleId);
 const suffix=params.size?"?"+params.toString():"";
 const data=await api("/associations/"+state.associationId+"/hierarchy"+suffix);
 state.hierarchy=data.items||[];
 renderStructure();populateCircleSelects();
}
async function loadStudents(){
 const params=new URLSearchParams();
 if(state.circleOnlyMode&&state.activeCircleId)params.set("circleId",state.activeCircleId);
 const suffix=params.size?"?"+params.toString():"";
 const data=await api("/associations/"+state.associationId+"/students"+suffix);
 state.students=data.students||[];
 renderStudents();renderAttendanceRows();
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function nav(view){
 const allowed={home:!state.circleOnlyMode,structure:!state.circleOnlyMode&&hasAnyPermission(["premises:read","premises:create","circles:read","circles:create"]),
  students:hasPermission("students:read"),
  attendance:hasAnyPermission(["attendance:record","attendance:update","recitations:record","recitations:update"]),
  reports:hasPermission("reports:read"),settings:hasPermission("settings:manage")||hasPermission("evaluations:manage")};
 if(!allowed[view]){toast("ليس لديك صلاحية لفتح هذا القسم.");return;}
 $$(".nav-item,.mobile-bottom-nav [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
 $$(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+view));
 $("#pageTitle").textContent=({home:"الرئيسية",structure:"الهيكل التنظيمي",students:roleSet().has("guardian")?"أبنائي":"الطلاب",attendance:"الرصد اليومي",reports:"التقارير",settings:"الإعدادات"})[view];
 $(".sidebar").classList.remove("open");if(view==="students")renderStudents();if(view==="attendance")renderAttendanceRows();
}
function renderHome(){const branches=new Set(state.hierarchy.map(x=>x.branch_id));const premises=new Map(state.hierarchy.filter(x=>x.premise_id).map(x=>[x.premise_id,x]));const circles=new Set(state.hierarchy.filter(x=>x.circle_id).map(x=>x.circle_id));$("#homeStats").innerHTML=[["الفروع",branches.size],["المساجد والمقرات",premises.size],["الحلقات",circles.size],["الطلاب",state.students.length]].map(([n,v])=>'<article class="stat-card"><span>'+n+'</span><strong>'+v.toLocaleString("ar-SA")+'</strong></article>').join("");$("#homeStructure").innerHTML=state.hierarchy.length?state.hierarchy.slice(0,8).map(x=>'<div class="premise-card"><strong>'+esc(x.premise_name||x.branch_display_name||"فرع")+'</strong><div class="muted">'+esc(x.city||"")+' · '+esc(x.district||"")+'</div>'+(x.circle_name?'<span class="circle-chip">'+esc(x.circle_name)+'</span>':"")+'</div>').join(""):'<div class="empty-state">لا توجد عناصر في الهيكل التنظيمي بعد.</div>'}
function renderStructure(){const groups=new Map();state.hierarchy.forEach(x=>{if(!groups.has(x.branch_id))groups.set(x.branch_id,{name:x.branch_display_name||x.city||"فرع",city:x.city,district:x.district,premises:new Map()});if(x.premise_id){const g=groups.get(x.branch_id);if(!g.premises.has(x.premise_id))g.premises.set(x.premise_id,{name:x.premise_name,type:x.premise_type,circles:[]});if(x.circle_id)g.premises.get(x.premise_id).circles.push(x.circle_name)}});$("#structureList").innerHTML=groups.size?[...groups.values()].map(g=>'<article class="branch-card"><h3>'+esc(g.name)+'</h3><small class="muted">'+esc(g.city||"")+' · '+esc(g.district||"")+'</small>'+[...g.premises.values()].map(p=>'<div class="premise-card"><div class="premise-head"><strong>'+esc(p.name)+'</strong><span class="status-pill">'+(labels[p.type]||"")+'</span></div>'+p.circles.map(c=>'<span class="circle-chip">'+esc(c)+'</span>').join("")+'</div>').join("")+'</article>').join(""):'<div class="panel empty-state">لا توجد فروع أو مساجد مسجلة.</div>';const premises=[...new Map(state.hierarchy.filter(x=>x.premise_id).map(x=>[x.premise_id,{id:x.premise_id,name:x.premise_name}])).values()];$("#circlePremise").innerHTML=premises.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join("")||'<option value="">أضف مسجدًا أو مقرًا أولًا</option>'}
function populateCircleSelects(){
 const circles=[...new Map(state.hierarchy.filter(x=>x.circle_id).map(x=>[x.circle_id,{id:x.circle_id,name:x.circle_name}])).values()];
 ["studentCircleFilter","attendanceCircle","reportCircle"].forEach(id=>{
  const el=$("#"+id),prev=el.value;
  el.innerHTML=(state.circleOnlyMode?"":(id==="studentCircleFilter"||id==="reportCircle"?'<option value="">جميع الحلقات</option>':""))+circles.map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join("");
  if(state.activeCircleId&&[...el.options].some(o=>o.value===state.activeCircleId))el.value=state.activeCircleId;
  else if([...el.options].some(o=>o.value===prev))el.value=prev;
  if(state.circleOnlyMode)el.disabled=true;
  else el.disabled=false;
 });
}
function renderStudents(){const q=$("#studentSearch").value.trim().toLocaleLowerCase();const circle=$("#studentCircleFilter").value,status=$("#studentStatusFilter").value;const rows=state.students.filter(s=>(!q||(s.fullName+" "+s.fileNumber).toLocaleLowerCase().includes(q))&&(!circle||s.circleId===circle)&&(!status||s.educationalStatus===status));$("#studentsRows").innerHTML=rows.length?rows.map(s=>'<tr><td><strong>'+esc(s.fullName)+'</strong></td><td>'+esc(s.fileNumber)+'</td><td>'+esc(s.circleName||"—")+'</td><td><span class="status-pill '+(s.educationalStatus==="expelled"?"expelled":s.educationalStatus==="temporarily_suspended"?"suspended":"")+'">'+(labels[s.educationalStatus]||s.educationalStatus)+'</span></td><td>'+Number(s.previousMemorizedJuz||0).toLocaleString("ar-SA")+' جزء</td></tr>').join(""):'<tr><td colspan="5" class="empty-state">لا توجد نتائج مطابقة.</td></tr>'}
function renderAttendanceRows(){const circle=$("#attendanceCircle").value;const rows=state.students.filter(s=>s.circleId===circle&&s.educationalStatus==="active");$("#attendanceCount").textContent=rows.length+" طالب";$("#attendanceRows").innerHTML=rows.map(s=>{const status=state.attendance[s.id]||"unrecorded";return '<div class="attendance-row"><div><strong>'+esc(s.fullName)+'</strong><small>'+esc(s.fileNumber)+' · '+(status==="unrecorded"?"لم يُسجّل": "تم تحديد الحالة")+'</small></div><div class="attendance-actions"><div class="attendance-options">'+[["present","حاضر"],["absent","غائب"],["excused_absence","بعذر"],["late","متأخر"],["leave","إجازة"]].map(([v,l])=>'<button data-student="'+s.id+'" data-status="'+v+'" class="'+(status===v?"selected":"")+'">'+l+'</button>').join("")+'</div><button class="text-btn" data-recitation="'+s.id+'">＋ تسجيل التسميع</button></div></div>'}).join("")||'<div class="empty-state">لا يوجد طلاب نشطون في الحلقة المحددة.</div>'}

async function addRecitation(studentId){
 const s=state.students.find(x=>x.id===studentId);if(!s)throw Error("تعذر العثور على الطالب.");
 openModal("تسجيل تسميع · "+esc(s.fullName),'<form id="recitationForm"><label>نوع التسميع</label><select name="track"><option value="new_memorization">حفظ جديد</option><option value="minor_review">مراجعة صغرى</option><option value="major_review">مراجعة كبرى</option></select><div class="form-grid"><label>من سورة (رقم)<input name="fromSurah" type="number" min="1" max="114" required value="1"></label><label>من آية<input name="fromAyah" type="number" min="1" max="300" required value="1"></label><label>إلى سورة (رقم)<input name="toSurah" type="number" min="1" max="114" required value="1"></label><label>إلى آية<input name="toAyah" type="number" min="1" max="300" required value="1"></label><label>عدد الصفحات<input name="pagesCount" type="number" min="0" max="604" step="0.25" required value="1"></label><label>التقدير<select name="dailyRating"><option value="excellent">ممتاز</option><option value="very_good">جيد جدًا</option><option value="good">جيد</option><option value="acceptable">مقبول</option><option value="retry">يحتاج إعادة</option><option value="not_recited">لم يسمّع</option></select></label><label>الدرجة من ١٠<input name="scoreOutOf10" type="number" min="0" max="10" step="0.5" value="10" required></label><label>أخطاء التجويد<input name="tajweedErrors" type="number" min="0" value="0"></label><label>أخطاء القراءة<input name="readingErrors" type="number" min="0" value="0"></label></div><label>ملاحظة المعلم (اختياري)</label><input name="teacherNote" maxlength="500"><button class="btn primary" type="submit">حفظ التسميع</button></form>');
 $("#recitationForm").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const b={studentId,circleId:s.circleId,sessionDate:$("#attendanceDate").value,hijriPeriodKey:$("#hijriPeriod").value.trim(),track:f.track,fromSurah:Number(f.fromSurah),fromAyah:Number(f.fromAyah),toSurah:Number(f.toSurah),toAyah:Number(f.toAyah),pagesCount:Number(f.pagesCount),dailyRating:f.dailyRating,scoreOutOf10:Number(f.scoreOutOf10),tajweedErrors:Number(f.tajweedErrors),readingErrors:Number(f.readingErrors),teacherNote:f.teacherNote||undefined};if(!b.hijriPeriodKey)throw Error("أدخل مفتاح الفترة الهجرية في شاشة الرصد.");await api("/associations/"+state.associationId+"/recitations",{method:"POST",body:JSON.stringify(b)});closeModal();toast("تم حفظ تسميع الطالب.");};
}
async function saveAttendance(){const circleId=$("#attendanceCircle").value,date=$("#attendanceDate").value,hijri=$("#hijriPeriod").value.trim();if(!circleId||!date||!hijri)throw Error("حدد الحلقة والتاريخ والفترة الهجرية.");const entries=state.students.filter(s=>s.circleId===circleId&&s.educationalStatus==="active"&&state.attendance[s.id]).map(s=>({studentId:s.id,circleId,sessionDate:date,hijriPeriodKey:hijri,status:state.attendance[s.id]}));if(!entries.length)throw Error("لم تحدد حالة أي طالب بعد. سجّل الحالات أو استخدم «تحديد حضور الجميع».");await api("/associations/"+state.associationId+"/attendance",{method:"POST",body:JSON.stringify({entries})});toast("تم حفظ رصد "+entries.length+" طالب.");}
async function loadReport(){const period=$("#reportPeriod").value.trim();if(!period)throw Error("أدخل مفتاح الفترة الهجرية.");const circle=$("#reportCircle").value;const params=new URLSearchParams({hijriPeriodKey:period});if(circle)params.set("circleId",circle);const data=await api("/associations/"+state.associationId+"/reports/monthly?"+params);state.report=data;const rows=data.students||[];$("#reportSummary").innerHTML=[["الطلاب",rows.length],["أوزان التقييم",Object.values(data.weights||{}).join(" / ")],["الفترة",data.hijriPeriodKey]].map(([n,v])=>'<article class="stat-card"><span>'+n+'</span><strong style="font-size:20px">'+esc(v)+'</strong></article>').join("");$("#reportRows").innerHTML=rows.map(s=>'<tr><td>'+esc(s.fullName)+'</td><td>'+esc(s.circleName||"—")+'</td><td>'+Number(s.attendedDays||0).toLocaleString("ar-SA")+' / '+Number(s.studyDays||0).toLocaleString("ar-SA")+'</td><td>'+Number(s.adjustedMemorizationPages||0).toLocaleString("ar-SA")+'</td><td>'+Number(s.adjustedReviewPages||0).toLocaleString("ar-SA")+'</td><td>'+Number(s.finalPercentage||0).toLocaleString("ar-SA")+'٪</td></tr>').join("")||'<tr><td colspan="6" class="empty-state">لا توجد نتائج لهذه الفترة.</td></tr>'}
function openModal(title,body){$("#modalContent").innerHTML="<h3>"+title+"</h3>"+body;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden")}
async function addPremise(){openModal("إضافة مسجد أو مقر قرآني",'<form id="premiseForm"><label>النوع</label><select name="premiseType"><option value="mosque">مسجد</option><option value="quranic_center">مقر قرآني</option></select><label>الاسم</label><input name="name" required minlength="2"><label>المدينة</label><input name="city" required value="جدة"><label>الحي</label><input name="district" required><label>المنطقة الإدارية (اختياري)</label><input name="administrativeRegion"><button class="btn primary" type="submit">حفظ</button></form>');$("#premiseForm").onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));await api("/associations/"+state.associationId+"/premises",{method:"POST",body:JSON.stringify(b)});closeModal();await loadHierarchy();toast("تمت إضافة المسجد أو المقر.")}}
function invitationRoleOptions(){
 const roles=roleSet();
 const options=[];
 const canInviteLower=["association_manager","association_deputy","branch_manager","branch_deputy","supervisor","supervisor_deputy"].some(r=>roles.has(r));
 if(canInviteLower){
  options.push(["teacher","معلم"],["circle_assistant","مساعد حلقة"],["guardian","ولي أمر"]);
 }else if(roles.has("teacher")){
  options.push(["guardian","ولي أمر"]);
 }
 return options;
}
function openInvitationDialog(){
 if(!hasPermission("invitations:create")){
  toast("ليس لديك صلاحية إرسال الدعوات.");return;
 }
 const roles=invitationRoleOptions();
 if(!roles.length){toast("لا يوجد دور يمكنك إسناده من صلاحيات حسابك.");return;}
 const circles=[...new Map(state.hierarchy.filter(x=>x.circle_id).map(x=>[x.circle_id,{
  id:x.circle_id,name:x.circle_name,premiseName:x.premise_name
 }])).values()];
 const students=state.students.filter(x=>x.id);
 const roleOptions=roles.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join("");
 const circleOptions=circles.map(x=>'<option value="'+x.id+'">'+esc(x.name)+(x.premiseName?" — "+esc(x.premiseName):"")+'</option>').join("");
 const studentOptions=students.map(x=>'<option value="'+x.id+'">'+esc(x.fullName)+(x.circleName?" — "+esc(x.circleName):"")+'</option>').join("");
 openModal("إرسال دعوة بالبريد الإلكتروني",
  '<p class="muted">سيصل للمدعو إشعار بالإضافة فقط. إذا كان لديه حساب سيُضاف إليه الدور، وإن لم يكن لديه حساب فينشئه بالبريد نفسه.</p>'+
  '<form id="inviteMemberForm" class="invite-form">'+
   '<label for="inviteRole">الدور المطلوب إسناده</label><select id="inviteRole" required>'+roleOptions+'</select>'+
   '<label for="inviteEmail">البريد الإلكتروني للمدعو</label><input id="inviteEmail" type="email" autocomplete="email" required placeholder="name@example.com">'+
   '<label for="invitePhone">رقم الجوال (اختياري)</label><input id="invitePhone" type="tel" inputmode="tel" placeholder="05xxxxxxxx">'+
   '<div id="inviteCircleWrap"><label for="inviteCircle">الحلقة التي سيعمل بها</label><select id="inviteCircle" required>'+circleOptions+'</select></div>'+
   '<div id="inviteStudentWrap" class="hidden"><label for="inviteStudent">الطالب المرتبط بولي الأمر</label><select id="inviteStudent" required>'+studentOptions+'</select><label for="inviteRelationship">صلة القرابة</label><input id="inviteRelationship" value="ولي أمر" maxlength="64"></div>'+
   '<p id="inviteFormMessage" class="form-message" role="status"></p>'+
   '<button class="btn primary full" type="submit">إرسال الإشعار</button>'+
  '</form>');
 const form=$("#inviteMemberForm"),role=$("#inviteRole"),circleWrap=$("#inviteCircleWrap"),studentWrap=$("#inviteStudentWrap");
 const roleNeedsCircle=()=>role.value==="teacher"||role.value==="circle_assistant";
 const updateFields=()=>{
  const guardian=role.value==="guardian";
  circleWrap.classList.toggle("hidden",!roleNeedsCircle());
  studentWrap.classList.toggle("hidden",!guardian);
  $("#inviteCircle").required=roleNeedsCircle();
  $("#inviteStudent").required=guardian;
  if(guardian&&!students.length)$("#inviteFormMessage").textContent="لا توجد ملفات طلاب ضمن نطاق صلاحيتك لربط ولي الأمر.";
  else $("#inviteFormMessage").textContent="";
 };
 role.onchange=updateFields;updateFields();
 form.onsubmit=async e=>{
  e.preventDefault();
  const roleCode=role.value,guardian=roleCode==="guardian";
  if(roleNeedsCircle()&&!circles.length){$("#inviteFormMessage").textContent="لا توجد حلقة متاحة ضمن نطاق صلاحيتك.";return;}
  if(guardian&&!students.length){$("#inviteFormMessage").textContent="لا توجد ملفات طلاب ضمن نطاق صلاحيتك.";return;}
  const body={
   inviteType:guardian?"guardian_link":"staff_role",
   recipientEmail:$("#inviteEmail").value.trim().toLowerCase(),
   roleCode,
   scopeType:guardian?"guardian_children":"circle",
   expiresInHours:72
  };
  const phone=$("#invitePhone").value.trim();if(phone)body.recipientPhone=phone;
  if(guardian){
   body.targetStudentId=$("#inviteStudent").value;
   body.relationshipLabel=$("#inviteRelationship").value.trim()||"ولي أمر";
  }else{
   body.circleId=$("#inviteCircle").value;
  }
  const submit=form.querySelector('button[type="submit"]');
  submit.disabled=true;submit.textContent="جارٍ إرسال الإشعار…";
  try{
   const result=await api("/associations/"+state.associationId+"/invitations",{
    method:"POST",body:JSON.stringify(body)
   });
   closeModal();
   const assigned=result.invitation?.membershipAssigned;
   toast(assigned?"وصل إشعار البريد وأُسند الدور إلى الحساب الموجود.":"تم إرسال إشعار الإضافة إلى البريد الإلكتروني.");
  }catch(err){
   $("#inviteFormMessage").textContent=err.message;
   submit.disabled=false;submit.textContent="إرسال الإشعار";
  }
 };
}
async function addStudent(){const circles=[...new Map(state.hierarchy.filter(x=>x.circle_id).map(x=>[x.circle_id,{id:x.circle_id,name:x.circle_name}])).values()];openModal("إضافة طالب",'<form id="newStudentForm"><label>اسم الطالب</label><input name="fullName" required minlength="3"><label>رقم الجوال</label><input name="phone" required placeholder="05xxxxxxxx" inputmode="tel"><label>البريد الإلكتروني</label><input name="email" type="email" required><label>الحلقة</label><select name="circleId" required>'+circles.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join("")+'</select><label>الأجزاء المحفوظة سابقًا</label><input name="previousMemorizedJuz" type="number" min="0" max="30" value="0"><button class="btn primary" type="submit">إضافة الطالب</button></form>');$("#newStudentForm").onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));b.previousMemorizedJuz=Number(b.previousMemorizedJuz);await api("/associations/"+state.associationId+"/students",{method:"POST",body:JSON.stringify(b)});closeModal();await loadStudents();renderHome();toast("تم تسجيل الطالب.")}}
async function createCircle(e){e.preventDefault();const b={quranicPremiseId:$("#circlePremise").value,name:$("#circleName").value.trim(),studyPeriod:$("#circlePeriod").value,targetStage:$("#circleStage").value.trim()||undefined};await api("/associations/"+state.associationId+"/circles",{method:"POST",body:JSON.stringify(b)});e.target.reset();await loadHierarchy();toast("تم إنشاء الحلقة.")}
async function checkApi(){
 if(!API){$("#apiStatus").textContent="عنوان API_BASE_URL غير مضبوط. انشر Backend ثم ضع رابطه في assets/js/rasikh-config.js.";return;}
 const r=await fetch(API+"/health/ready",{credentials:"include"});
 const d=await r.json();
 $("#apiStatus").textContent=r.ok?"الخادم وقاعدة البيانات متصلان.":"الخادم غير جاهز: "+(d.database||r.status);
}
async function showOnboarding(){
 $("#loginView").classList.add("hidden");$("#assignmentSelectView").classList.add("hidden");$("#appView").classList.add("hidden");$("#onboardingView").classList.remove("hidden");
 try{
  const status=await api("/onboarding/status"),pending=status.pendingRegistrations||[],box=$("#pendingRegistration");
  if(pending.length){box.classList.remove("hidden");box.innerHTML="<strong>طلب جمعية قيد التحقق</strong><div>"+pending.map(x=>"رقم الترخيص: "+esc(x.license_number)+" — الجهة المرخِّصة: "+esc(x.licensing_authority)).join("<br>")+"</div><p>سيُعتمد اسم الجمعية من بيانات الجهة المختصة بعد التحقق، ولن تُفعّل صلاحيات إدارتها قبل الاعتماد.</p>";$("#workspaceOptions").classList.add("hidden");}
  else{box.classList.add("hidden");$("#workspaceOptions").classList.remove("hidden");}
 }catch(e){$("#onboardingMessage").textContent=e.message;}
}
function showInvitationRegistration(info){
 state.invitationInfo=info;$("#loginView").classList.remove("hidden");$("#onboardingView").classList.add("hidden");$("#appView").classList.add("hidden");
 $("#passwordLoginForm").classList.add("hidden");$("#registerForm").classList.add("hidden");$("#resetRequestForm").classList.add("hidden");$("#resetConfirmForm").classList.add("hidden");
 $("#tabLogin").classList.add("hidden");$("#tabRegister").classList.add("hidden");
 $("#authTitle").textContent="قبول الدعوة";$("#authDescription").textContent="أكمل بيانات حسابك لقبول الدعوة المرسلة إليك.";
 $("#invitationEmail").value=info.email;$("#invitationSummary").textContent="دعوة إلى "+info.organizationName+" · الدور: "+info.roleCode+" · تنتهي في "+new Date(info.expiresAt).toLocaleString("ar-SA");
 $("#invitationRegisterForm").classList.remove("hidden");$("#invitationFullName").focus();
}
async function initializeInvitation(token){state.invitationToken=token;const info=await api("/auth/invitations/"+encodeURIComponent(token)+"/preview");showInvitationRegistration(info.invitation);}
async function finishSessionAndRoute(){if(state.invitationToken){try{await acceptPendingInvitation();}catch(e){msg($("#authMessage"),e.message);return;}}await afterAuthenticated();}
async function initializeGoogle(){
 const note=$("#googleSetupNote"),slot=$("#googleButton"),clientId=window.RASIKH_CONFIG?.GOOGLE_CLIENT_ID||"";
 if(!API||!clientId){note.classList.remove("hidden");slot.classList.add("hidden");return;}
 try{
  const nonceData=await api("/auth/google/nonce",{method:"POST",body:"{}"});
  const ready=()=>{
   if(!window.google?.accounts?.id){note.classList.remove("hidden");note.textContent="تعذر تحميل تسجيل Google. تحقق من الاتصال ثم أعد تحميل الصفحة.";return;}
   window.google.accounts.id.initialize({client_id:clientId,nonce:nonceData.nonce,callback:async response=>{
    try{await api("/auth/google",{method:"POST",body:JSON.stringify({credential:response.credential,nonce:nonceData.nonce})});await finishSessionAndRoute();}
    catch(e){msg($("#authMessage"),e.message);}
   }});
   window.google.accounts.id.renderButton(slot,{type:"standard",theme:"outline",size:"large",text:"continue_with",shape:"rectangular",logo_alignment:"left",width:360,locale:"ar"});
   note.classList.add("hidden");
  };
  if(window.google?.accounts?.id)ready();
  else{
   const googleScript=document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
   if(googleScript){
    googleScript.addEventListener("load",ready,{once:true});
    googleScript.addEventListener("error",()=>{note.classList.remove("hidden");note.textContent="تعذر تحميل خدمة Google. تحقق من الاتصال ثم أعد المحاولة.";},{once:true});
   }else{note.classList.remove("hidden");note.textContent="مكتبة تسجيل Google غير موجودة في الصفحة.";}
  }
 }catch(e){note.classList.remove("hidden");note.textContent=e.message;}
}
async function beginAuthFromUrl(){
 const params=new URLSearchParams(location.search),invitation=params.get("invitation"),verify=params.get("verifyEmail"),reset=params.get("resetPassword");
 if(invitation){try{await initializeInvitation(invitation);return true;}catch(e){msg($("#authMessage"),e.message);return false;}}
 if(verify){try{await api("/auth/email/verify",{method:"POST",body:JSON.stringify({token:verify})});const url=new URL(location.href);url.searchParams.delete("verifyEmail");history.replaceState({}, "",url.toString());await afterAuthenticated();return true;}catch(e){msg($("#authMessage"),e.message);return false;}}
 if(reset){state.resetToken=reset;$("#passwordLoginForm").classList.add("hidden");$("#registerForm").classList.add("hidden");$("#tabLogin").classList.add("hidden");$("#tabRegister").classList.add("hidden");$("#authTitle").textContent="استعادة كلمة المرور";$("#authDescription").textContent="أدخل كلمة مرور جديدة لحسابك.";$("#resetConfirmForm").classList.remove("hidden");return true;}
 return false;
}
async function submitPasswordLogin(e){e.preventDefault();try{await api("/auth/password/login",{method:"POST",body:JSON.stringify({email:$("#loginEmail").value.trim(),password:$("#loginPassword").value})});await finishSessionAndRoute();}catch(err){msg($("#authMessage"),err.message);}}
async function submitRegistration(e){e.preventDefault();try{const data=await api("/auth/register",{method:"POST",body:JSON.stringify({fullName:$("#registerFullName").value.trim(),email:$("#registerEmail").value.trim(),password:$("#registerPassword").value})});msg($("#authMessage"),data.message||"افتح رسالة البريد لإكمال إنشاء الحساب.",false);e.target.reset();}catch(err){msg($("#authMessage"),err.message);}}
async function submitInvitationRegistration(e){
 e.preventDefault();
 try{await api("/auth/invitations/register",{method:"POST",body:JSON.stringify({token:state.invitationToken,fullName:$("#invitationFullName").value.trim(),password:$("#invitationPassword").value})});state.invitationToken=null;const url=new URL(location.href);url.searchParams.delete("invitation");history.replaceState({}, "",url.toString());await afterAuthenticated();}
 catch(err){msg($("#authMessage"),err.message);if(err.message.includes("لديه حساب بالفعل")){$("#invitationRegisterForm").classList.add("hidden");setAuthMode("login");$("#loginEmail").value=state.invitationInfo?.email||"";$("#authTitle").textContent="سجّل الدخول لقبول الدعوة";}}
}
async function submitResetRequest(e){e.preventDefault();try{const data=await api("/auth/password-reset/request",{method:"POST",body:JSON.stringify({email:$("#resetEmail").value.trim()})});msg($("#authMessage"),data.message,false);}catch(err){msg($("#authMessage"),err.message);}}
async function submitResetConfirm(e){e.preventDefault();try{const data=await api("/auth/password-reset/confirm",{method:"POST",body:JSON.stringify({token:state.resetToken,password:$("#newPassword").value})});state.resetToken=null;const url=new URL(location.href);url.searchParams.delete("resetPassword");history.replaceState({}, "",url.toString());setAuthMode("login");msg($("#authMessage"),data.message,false);}catch(err){msg($("#authMessage"),err.message);}}
function showForgotPassword(){setAuthMode("login");$("#passwordLoginForm").classList.add("hidden");$("#resetRequestForm").classList.remove("hidden");$("#authTitle").textContent="استعادة كلمة المرور";$("#authDescription").textContent="سنرسل رابطًا آمنًا إلى بريدك الإلكتروني.";}
async function createWorkspace(type){
 $("#onboardingMessage").textContent="";
 if(type==="association"){$("#workspaceOptions").classList.add("hidden");$("#associationSetup").classList.remove("hidden");return;}
 if(type==="independent_mosque"||type==="independent_quranic_center"){$("#workspaceOptions").classList.add("hidden");$("#independentSetup").classList.remove("hidden");$("#independentKind").value=type;$("#independentTitle").textContent=type==="independent_mosque"?"إنشاء مسجد مستقل":"إنشاء مقر قرآني مستقل";return;}
 if(type==="demo"){try{await api("/onboarding/demo",{method:"POST",body:"{}"});await afterAuthenticated();}catch(e){$("#onboardingMessage").textContent=e.message;}}
}
async function submitAssociationSetup(e){e.preventDefault();try{const data=await api("/onboarding/association",{method:"POST",body:JSON.stringify({licenseNumber:$("#associationLicense").value.trim(),licensingAuthority:$("#licensingAuthority").value.trim()})});$("#associationSetup").classList.add("hidden");$("#pendingRegistration").classList.remove("hidden");$("#pendingRegistration").textContent=data.message;$("#workspaceOptions").classList.add("hidden");}catch(err){$("#onboardingMessage").textContent=err.message;}}
async function submitIndependentSetup(e){e.preventDefault();try{await api("/onboarding/independent",{method:"POST",body:JSON.stringify({workspaceKind:$("#independentKind").value,name:$("#independentName").value.trim(),city:$("#independentCity").value.trim(),district:$("#independentDistrict").value.trim(),administrativeRegion:$("#independentRegion").value.trim()||undefined,circleName:$("#independentCircleName").value.trim(),studyPeriod:$("#independentStudyPeriod").value})});await afterAuthenticated();}catch(err){$("#onboardingMessage").textContent=err.message;}}
async function boot(){
 if(await beginAuthFromUrl())return;
 try{await routeAuthenticatedUser();}
 catch(e){if(!API){msg($("#authMessage"),"عنوان الخادم غير مضبوط في assets/js/rasikh-config.js. إعداد API_BASE_URL مطلوب لتشغيل الدخول.");}else{msg($("#authMessage"),"سجّل الدخول للمتابعة.");}}
}
$("#assignmentLogout").onclick=async()=>{try{await api("/auth/logout",{method:"POST",body:"{}"});}catch{}location.reload();};
$("#changeAssignedCircle").onclick=()=>showAssignedCircleChooser(getAssignedCircleChoices());
$("#assignedCircleOptions").onclick=async e=>{const button=e.target.closest("[data-assigned-index]");if(!button)return;const choice=state.availableAssignedChoices[Number(button.dataset.assignedIndex)];if(!choice)return;try{await enterAssignedCircle(choice);}catch(err){msg($("#assignmentSelectMessage"),err.message);}};
$("#passwordLoginForm").onsubmit=submitPasswordLogin;$("#registerForm").onsubmit=submitRegistration;$("#invitationRegisterForm").onsubmit=submitInvitationRegistration;$("#resetRequestForm").onsubmit=submitResetRequest;$("#resetConfirmForm").onsubmit=submitResetConfirm;
$("#tabLogin").onclick=()=>setAuthMode("login");$("#tabRegister").onclick=()=>setAuthMode("register");$("#forgotPasswordBtn").onclick=showForgotPassword;$("#existingInviteAccount").onclick=()=>{setAuthMode("login");$("#loginEmail").value=state.invitationInfo?.email||"";};
$$("[data-return-login]").forEach(b=>b.onclick=()=>setAuthMode("login"));
$$("[data-workspace]").forEach(b=>b.onclick=()=>createWorkspace(b.dataset.workspace));
$$("[data-back-workspaces]").forEach(b=>b.onclick=()=>{$("#associationSetup").classList.add("hidden");$("#independentSetup").classList.add("hidden");$("#workspaceOptions").classList.remove("hidden");});
$("#associationSetupForm").onsubmit=submitAssociationSetup;$("#independentSetupForm").onsubmit=submitIndependentSetup;
$("#associationSelect").onchange=async e=>{state.associationId=e.target.value;state.circleOnlyMode=false;state.activeCircleId=null;refreshPermissions();renderNavigation();try{await loadCurrentAssociation();}catch(err){toast(err.message);}};
$("#sideNav").onclick=e=>{const b=e.target.closest("[data-view]");if(b&&!b.classList.contains("hidden"))nav(b.dataset.view);};
$(".mobile-bottom-nav").onclick=e=>{const b=e.target.closest("[data-view]");if(b&&!b.classList.contains("hidden"))nav(b.dataset.view);};
$("#content").onclick=e=>{const b=e.target.closest("[data-go]");if(b)nav(b.dataset.go);};
$("#mobileMenu").onclick=()=>$(".sidebar").classList.toggle("open");
$("#mobileAdd").onclick=()=>{
 const items=[];
 if(hasPermission("premises:create"))items.push('<button id="quickPremise">إضافة مسجد أو مقر</button>');
 if(hasPermission("circles:create"))items.push('<button id="quickCircle">إنشاء حلقة</button>');
 if(hasPermission("students:create"))items.push('<button id="quickStudent">إضافة طالب</button>');
 if(hasPermission("invitations:create"))items.push('<button id="quickInvitation">إرسال دعوة</button>');
 openModal("إضافة جديدة",'<div class="quick-actions">'+items.join("")+'</div>');
};
$("#mobileMore").onclick=()=>{
 const items=['<button id="moreProfile">الملف الشخصي</button>'];
 if(hasPermission("reports:read"))items.push('<button id="moreReports">التقارير</button>');
 if(hasAnyPermission(["attendance:record","recitations:record"]))items.push('<button id="moreAttendance">الرصد اليومي</button>');
 if(hasPermission("settings:manage")||hasPermission("evaluations:manage"))items.push('<button id="moreSettings">الإعدادات</button>');
 items.push('<button id="moreHelp">مركز المساعدة والتعلّم</button>','<button id="moreSupport">الدعم والتواصل</button>');
 openModal("المزيد",'<div class="quick-actions">'+items.join("")+'</div>');
};
$("#logoutBtn").onclick=$("#logoutSettings").onclick=async()=>{try{await api("/auth/logout",{method:"POST",body:"{}"});}catch{}location.reload();};
$("#inviteMemberBtn").onclick=()=>openInvitationDialog();
$("#addPremiseBtn").onclick=()=>addPremise();$("#addStudentBtn").onclick=()=>addStudent();$("#circleForm").onsubmit=async e=>{try{await createCircle(e);}catch(err){toast(err.message);}};
$("#studentSearch").oninput=renderStudents;$("#studentCircleFilter").onchange=renderStudents;$("#studentStatusFilter").onchange=renderStudents;
$("#attendanceCircle").onchange=()=>{state.attendance={};renderAttendanceRows();};$("#attendanceDate").onchange=()=>{state.attendance={};renderAttendanceRows();};
$("#attendanceRows").onclick=async e=>{const r=e.target.closest("[data-recitation]");if(r){try{await addRecitation(r.dataset.recitation);}catch(err){toast(err.message);}return;}const b=e.target.closest("[data-student]");if(!b)return;state.attendance[b.dataset.student]=b.dataset.status;renderAttendanceRows();};
$("#markAllPresent").onclick=()=>{state.students.filter(s=>s.circleId===$("#attendanceCircle").value&&s.educationalStatus==="active").forEach(s=>state.attendance[s.id]="present");renderAttendanceRows();};
$("#saveAttendance").onclick=async()=>{try{await saveAttendance();}catch(e){toast(e.message);}};
$("#loadReport").onclick=async()=>{try{await loadReport();}catch(e){toast(e.message);}};
$("#checkApi").onclick=async()=>{try{await checkApi();}catch(e){$("#apiStatus").textContent=e.message;}};
$("#modalContent").onclick=e=>{
 if(e.target.id==="quickPremise"){closeModal();addPremise();}
 if(e.target.id==="quickStudent"){closeModal();addStudent();}
 if(e.target.id==="quickCircle"){closeModal();nav("structure");$("#circleName").focus();}
 if(e.target.id==="quickInvitation"){closeModal();openInvitationDialog();}
 if(e.target.id==="moreAttendance"){closeModal();nav("attendance");}
 if(e.target.id==="moreReports"){closeModal();nav("reports");}
 if(e.target.id==="moreSettings"){closeModal();nav("settings");}
 if(e.target.id==="moreProfile"){closeModal();openModal("الملف الشخصي",'<p>'+esc(state.user?.fullName||"")+'</p><p>'+esc(state.user?.fileNumber||"")+'</p>');}
};
$("#closeModal").onclick=closeModal;$("#modal").onclick=e=>{if(e.target.id==="modal")closeModal();};
$("#attendanceDate").value=new Date().toISOString().slice(0,10);
window.addEventListener("load",initializeGoogle,{once:true});boot();
})();