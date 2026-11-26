(() => {
  const API = (window.RASIKH_API_BASE || '/api/v1').replace(/\/$/, '');
  const state = { user:null, assignments:[], associationId:null, hierarchy:[], students:[], active:'home' };
  const $ = (id) => document.getElementById(id);
  const esc = (v='') => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request = async (path, options={}) => {
    const response = await fetch(API + path, { credentials:'include', ...options, headers:{'Content-Type':'application/json', ...(options.headers||{})} });
    const body = await response.json().catch(()=>({}));
    if (!response.ok) { const e = new Error(body?.error?.message || 'تعذر تنفيذ الطلب.'); e.status=response.status; throw e; }
    return body;
  };
  const showMessage = (text, kind='info') => { const el=$('authMessage'); if(el){el.textContent=text;el.className='message';el.dataset.kind=kind;} };
  const showAuth = () => { $('authView').classList.remove('hidden'); $('appView').classList.add('hidden'); };
  const showApp = () => { $('authView').classList.add('hidden'); $('appView').classList.remove('hidden'); };
  const switchSection = (name) => {
    state.active=name;
    document.querySelectorAll('.section').forEach(x=>x.classList.toggle('active',x.id==='section-'+name));
    document.querySelectorAll('[data-section]').forEach(x=>x.classList.toggle('active',x.dataset.section===name));
    const titles={home:'الرئيسية',structure:'الهيكل التنظيمي',students:'الطلاب'};
    $('pageTitle').textContent=titles[name]||'الرئيسية';
    if(name==='structure') loadHierarchy();
    if(name==='students') loadStudents();
  };
  const renderAssignments = () => {
    const select=$('associationSelect');
    select.innerHTML=state.assignments.map(a=>'<option value="'+esc(a.association_id)+'">'+esc(a.association_name)+'</option>').join('');
    if(!state.assignments.length){select.innerHTML='<option value="">لا توجد عضويات متاحة</option>';return;}
    state.associationId=state.associationId||state.assignments[0].association_id;
    select.value=state.associationId;
  };
  const loadDashboard = async () => {
    showApp();
    $('headerName').textContent=state.user?.fullName||'مستخدم راسخ';
    $('welcomeName').textContent=state.user?.fullName||'مرحباً بك';
    renderAssignments();
    if(state.associationId){ await Promise.all([loadHierarchy(),loadStudents()]); }
    renderHome();
  };
  const loadHierarchy = async () => {
    if(!state.associationId){state.hierarchy=[];renderStructure();return;}
    try{const data=await request('/associations/'+encodeURIComponent(state.associationId)+'/hierarchy');state.hierarchy=data.items||[];renderStructure();renderHome();}
    catch(e){$('structureContent').innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
  };
  const loadStudents = async (q='') => {
    if(!state.associationId){state.students=[];renderStudents();return;}
    try{const query=q?'?q='+encodeURIComponent(q):'';const data=await request('/associations/'+encodeURIComponent(state.associationId)+'/students'+query);state.students=data.students||[];renderStudents();renderHome();}
    catch(e){$('studentsContent').innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
  };
  const uniqueCount = (key) => new Set(state.hierarchy.map(x=>x[key]).filter(Boolean)).size;
  const renderHome = () => {
    $('statBranches').textContent=String(uniqueCount('branch_id'));
    $('statPremises').textContent=String(uniqueCount('premise_id'));
    $('statCircles').textContent=String(uniqueCount('circle_id'));
    $('statStudents').textContent=String(state.students.length);
    $('homeAssociation').textContent=state.assignments.find(a=>a.association_id===state.associationId)?.association_name||'—';
    $('homeRole').textContent=state.assignments.find(a=>a.association_id===state.associationId)?.role_code||'عضوية';
  };
  const renderStructure = () => {
    if(!state.hierarchy.length){$('structureContent').innerHTML='<div class="empty">لا توجد عناصر في الهيكل التنظيمي ضمن نطاق صلاحيتك.</div>';return;}
    const branches=new Map();
    state.hierarchy.forEach(row=>{
      const key=row.branch_id||'none';
      if(!branches.has(key))branches.set(key,{name:row.branch_display_name||[row.city,row.district].filter(Boolean).join(' · ')||'فرع',city:row.city,district:row.district,premises:new Map()});
      const b=branches.get(key);
      if(row.premise_id){
        if(!b.premises.has(row.premise_id))b.premises.set(row.premise_id,{name:row.premise_name||'مقر قرآني',type:row.premise_type,circles:[]});
        if(row.circle_id)b.premises.get(row.premise_id).circles.push(row.circle_name||'حلقة');
      }
    });
    $('structureContent').innerHTML='<div class="tree-list">'+Array.from(branches.values()).map(b=>'<article class="tree-branch"><h3>'+esc(b.name)+'</h3><div class="tree-meta">'+esc([b.city,b.district].filter(Boolean).join(' · '))+'</div>'+Array.from(b.premises.values()).map(p=>'<div class="tree-premise"><strong>'+esc(p.name)+'</strong><div class="tree-meta">'+esc(p.type||'')+'</div>'+p.circles.map(c=>'<span class="tree-circle">'+esc(c)+'</span>').join('')+'</div>').join('')+'</article>').join('')+'</div>';
  };
  const renderStudents = () => {
    if(!state.students.length){$('studentsContent').innerHTML='<div class="empty">لا توجد سجلات طلاب متاحة ضمن نطاق صلاحيتك.</div>';return;}
    $('studentsContent').innerHTML='<div class="table-wrap"><table><thead><tr><th>اسم الطالب</th><th>رقم الملف</th><th>الحلقة</th><th>المقر</th><th>الحالة</th></tr></thead><tbody>'+state.students.map(s=>'<tr><td>'+esc(s.full_name)+'</td><td>'+esc(s.file_number)+'</td><td>'+esc(s.circle_name||'—')+'</td><td>'+esc(s.premise_name||'—')+'</td><td><span class="status">'+esc(s.educational_status||'—')+'</span></td></tr>').join('')+'</tbody></table></div>';
  };
  const boot = async () => {
    try{
      const me=await request('/auth/me');
      state.user=me.user;state.assignments=me.assignments||[];
      await loadDashboard();
    }catch(e){if(e.status===401){showAuth();}else{showAuth();showMessage(e.message,'error');}}
  };
  $('requestOtp').addEventListener('click',async()=>{
    const identifier=$('identifier').value.trim();
    const identifierType=$('identifierType').value;
    if(!identifier){showMessage('أدخل رقم الجوال أو البريد الإلكتروني أولاً.','error');return;}
    $('requestOtp').disabled=true;
    try{const data=await request('/auth/otp/request',{method:'POST',body:JSON.stringify({identifierType,identifier})});$('otpStep').classList.remove('hidden');showMessage(data.message||'تم إنشاء طلب رمز التحقق. إذا لم يصلك الرمز، فقد تحتاج قناة الإرسال إلى إعداد من الخادم.');}
    catch(e){showMessage(e.message,'error');}
    finally{$('requestOtp').disabled=false;}
  });
  $('verifyOtp').addEventListener('click',async()=>{
    const identifier=$('identifier').value.trim(), code=$('otpCode').value.trim(), identifierType=$('identifierType').value;
    if(!/^\d{6}$/.test(code)){showMessage('أدخل رمز التحقق المكوّن من ٦ أرقام.','error');return;}
    try{await request('/auth/otp/verify',{method:'POST',body:JSON.stringify({identifierType,identifier,code})});await boot();}
    catch(e){showMessage(e.message,'error');}
  });
  $('logoutBtn').addEventListener('click',async()=>{try{await request('/auth/logout',{method:'POST'});}catch{}state.user=null;state.assignments=[];showAuth();});
  $('associationSelect').addEventListener('change',async(e)=>{state.associationId=e.target.value;await Promise.all([loadHierarchy(),loadStudents()]);renderHome();});
  document.querySelectorAll('[data-section]').forEach(el=>el.addEventListener('click',()=>switchSection(el.dataset.section)));
  $('studentSearch').addEventListener('input',(e)=>loadStudents(e.target.value.trim()));
  $('refreshBtn').addEventListener('click',()=>boot());
  boot();
})();