/* English Study Hub - static, no backend. Original exercise/*.html files are never modified. */
(() => {
  'use strict';
  const data = window.STUDY_DATA;
  if (!data || !Array.isArray(data.courses)) {
    document.getElementById('app').textContent = 'Không đọc được danh sách bài học. Hãy kiểm tra assets/data.js.';
    return;
  }

  // One-page hash navigation preserves the in-memory Google OAuth token.
  function parseRoute() {
    const [view, query = ''] = location.hash.replace(/^#/, '').split('?');
    return { view: view === 'progress' ? 'progress' : 'library', params: new URLSearchParams(query) };
  }
  let route = parseRoute();
  let page = route.view;
  let params = route.params;
  const allCourseIds = new Set(data.courses.map(c => c.id));
  const lessonIds = new Set(data.lessons.map(l => l.id));
  const exerciseIds = new Set(data.exercises.map(e => e.id));
  const lessonsById = new Map(data.lessons.map(l => [l.id, l]));
  const exercisesById = new Map(data.exercises.map(e => [e.id, e]));
  let courseFilter = allCourseIds.has(params.get('course')) ? params.get('course') : 'all';
  let progressCourse = allCourseIds.has(params.get('course')) ? params.get('course') : data.courses[0].id;
  let exerciseFilter = 'all';
  let lessonFilter = 'all';
  let librarySearch = '';
  let lessonSearch = '';
  let hasCatalogRendered = false;
  let hasProgressListRendered = false;
  let toastTimer;
  let writeBusy = false;
  let syncBusy = false;
  let lastError = '';
  const icons = {blue:'\ud83d\udcd8',purple:'\ud83d\udcd7',orange:'\ud83d\udcd9'};

  function blankProgress() { return { lessons: {}, exercises: {} }; }
  let progress = blankProgress();
  const sheets = new window.GoogleSheetsStore(window.GOOGLE_SHEETS_CONFIG || {}, data, {
    onBusy: active => { syncBusy = active; if (!active) renderFullApp(); else { renderSaveIndicator();renderConnectionBanner(); } },
    onReady: next => { progress = next; lastError = ''; renderFullApp(); },
    onError: message => { lastError = message; if (!sheets.connected) progress = blankProgress(); toast(message); renderSaveIndicator(); renderConnectionBanner(); },
    onDisconnected: () => { progress = blankProgress(); lastError = ''; renderFullApp(); }
  });
  function canEdit() { return sheets.connected && !writeBusy && !syncBusy; }
  function renderConnectionBanner() {
    const el = document.getElementById('connection-banner');
    if (!el) return;
    const link = sheets.configured ? `<a href="${esc(sheets.sheetUrl)}" target="_blank" rel="noopener noreferrer">M\u1edf Google Sheet &#8599;</a>` : '';
    let html;
    if (!sheets.configured) {
      html = `<strong>Ch\u01b0a c\u1ea5u h\u00ecnh Google Sheets.</strong> M\u1edf <code>assets/config.js</code> v\u00e0 nh\u1eadp OAuth Client ID c\u00f9ng Spreadsheet ID, sau \u0111\u00f3 deploy l\u00ean GitHub Pages.`;
    } else if (sheets.connected) {
      html = `<strong>\u0110\u00e3 k\u1ebft n\u1ed1i Google Sheets.</strong> Ti\u1ebfn \u0111\u1ed9 \u0111\u01b0\u1ee3c \u0111\u1ecdc v\u00e0 l\u01b0u tr\u1ef1c ti\u1ebfp trong Google Sheets. ${link}<div class="connection-buttons"><button class="btn btn-small btn-outline" type="button" data-action="sheet-refresh" ${syncBusy || writeBusy ? 'disabled' : ''}>L\u00e0m m\u1edbi t\u1eeb Sheet</button><button class="btn btn-small btn-outline" type="button" data-action="sheet-disconnect" ${syncBusy || writeBusy ? 'disabled' : ''}>Ng\u1eaft k\u1ebft n\u1ed1i</button></div>`;
    } else {
      html = `<strong>K\u1ebft n\u1ed1i Google Sheets \u0111\u1ec3 theo d\u00f5i ti\u1ebfn \u0111\u1ed9.</strong> B\u1ea1n v\u1eabn c\u00f3 th\u1ec3 m\u1edf b\u00e0i t\u1eadp HTML khi ch\u01b0a \u0111\u0103ng nh\u1eadp. Ti\u1ebfn \u0111\u1ed9 kh\u00f4ng l\u01b0u trong tr\u00ecnh duy\u1ec7t.<div class="connection-buttons"><button class="btn btn-small" type="button" data-action="google-login" ${syncBusy ? 'disabled' : ''}>\u0110\u0103ng nh\u1eadp Google</button></div>`;
    }
    if (lastError) html += `<p class="connection-error" role="alert">${esc(lastError)}</p>`;
    el.className = 'connection-banner ' + (lastError || !sheets.configured ? 'needs-attention' : sheets.connected ? 'connected' : '');
    el.innerHTML = html;
  }
  function renderFullApp() {
    document.getElementById('app').innerHTML = shell();
    if (page === 'library') renderLibraryPage(); else renderProgressPage();
    renderSaveIndicator();
    renderConnectionBanner();
    if (page === 'progress' && params.get('lesson')) {
      const target = params.get('lesson');
      if (lessonIds.has(target)) requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({block:'center'}));
    } else if (page === 'library' && params.get('scroll') === '1') {
      requestAnimationFrame(() => document.getElementById('exercise-catalog')?.scrollIntoView({block:'start'}));
    }
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function encodedPath(p) { return p.split('/').map(encodeURIComponent).join('/'); }
  function progressUrl(c, l) {
    return `#progress?course=${encodeURIComponent(c)}${l ? `&lesson=${encodeURIComponent(l)}` : ''}`;
  }
  function libraryUrl(c) { return `#library?course=${encodeURIComponent(c)}`; }
  function getLessonStatus(id) { return progress.lessons[id]?.status || 'todo'; }
  function isExerciseDone(id) { return progress.exercises[id]?.completed === true; }
  function asPercent(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function courseStats(cid) {
    const l = cid === 'all' ? data.lessons : data.lessons.filter(x => x.courseId === cid);
    const e = cid === 'all' ? data.exercises : data.exercises.filter(x => x.courseId === cid);
    return {lessonTotal:l.length, lessonDone:l.filter(x=>getLessonStatus(x.id)==='done').length,
      lessonDoing:l.filter(x=>getLessonStatus(x.id)==='doing').length,
      exerciseTotal:e.length,exerciseDone:e.filter(x=>isExerciseDone(x.id)).length,
      minutesDone:Math.round(l.filter(x=>getLessonStatus(x.id)==='done').reduce((s,x)=>s+(x.durationSeconds||0),0)/60)};
  }
  function formatStudyTime(minutes) { const h = Math.floor(minutes/60), m=minutes%60; return h ? `${h} giờ ${m} phút` : `${m} phút`; }
  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3500);
  }
  function renderSaveIndicator() {
    const el=document.getElementById('save-indicator');
    if (!el) return;
    const color = lastError ? '#ca4343' : (writeBusy || syncBusy) ? '#ce821e' : sheets.connected ? '#159c78' : '#a0aaba';
    const message = lastError ? 'Google Sheets: error' : writeBusy ? '\u0110ang l\u01b0u l\u00ean Google Sheets...' : syncBusy ? '\u0110ang t\u1ea3i t\u1eeb Google Sheets...' : sheets.connected ? '\u0110\u00e3 l\u01b0u tr\u00ean Google Sheets' : 'Ch\u01b0a k\u1ebft n\u1ed1i Google Sheets';
    el.innerHTML = `<span class="save-dot" style="background:${color}"></span>${message}`;
  }
  function shell() {
    const navLink = (href, symbol, text, current) => `<a class="side-link ${current?'active':''}" href="${href}"><span class="side-icon">${symbol}</span>${esc(text)}</a>`;
    return `<div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#library" aria-label="English Study Hub - Trang chủ">
          <span class="brand-icon">✦</span><span><strong>English Hub</strong><small>My learning space</small></span>
        </a>
        <div class="sidebar-label">Học tập</div>
        <nav aria-label="Điều hướng chính">
          ${navLink('#library','▦','Thư viện bài tập',page==='library')}
          ${navLink('#progress','◷','Theo dõi tiến độ',page==='progress')}
        </nav>
        <div class="sidebar-label">Khóa học</div>
        <nav aria-label="Khóa học">
          ${data.courses.map(c=>navLink(progressUrl(c.id),icons[c.color],c.level,false)).join('')}
        </nav>
        <div class="sidebar-bottom"><div class="sidebar-note"><strong>Ch\u1ec9 d\u00f9ng Google Sheets</strong>Ti\u1ebfn \u0111\u1ed9 ch\u1ec9 l\u01b0u tr\u00ean Google Sheets. H\u00e3y \u0111\u0103ng nh\u1eadp b\u1eb1ng t\u00e0i kho\u1ea3n c\u00f3 quy\u1ec1n s\u1eeda b\u1ea3ng t\u00ednh.</div></div>
      </aside>
      <div class="main">
        <div class="container"><header class="topbar"><div class="breadcrumbs">English Hub &nbsp; / &nbsp; <b>${page==='library'?'Thư viện bài tập':'Theo dõi tiến độ'}</b></div><div class="top-right"><span class="save-indicator" id="save-indicator"></span><span class="avatar" aria-hidden="true">🎓</span></div></header><div id="connection-banner"></div><main id="page-main"></main><footer class="footer">English Study Hub · GitHub Pages · Các HTML bài tập gốc được giữ nguyên.</footer></div>
      </div>
    </div>`;
  }
  function statsHtml(s) {
    return `<div class="stats-grid">
      ${statCard('Bài học đã hoàn thành',s.lessonDone,`/ ${s.lessonTotal} bài học`,'✅')}
      ${statCard('Đang học',s.lessonDoing,'bài đang thực hiện','📖')}
      ${statCard('Bài tập đã làm',s.exerciseDone,`/ ${s.exerciseTotal} file HTML`,'📝')}
      ${statCard('Thời lượng đã học',formatStudyTime(s.minutesDone),'tính từ các bài đã đánh dấu','⏱️')}
    </div>`;
  }
  function statCard(label,value,unit,icon) {return `<div class="stat-card"><div class="stat-head"><span>${esc(label)}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-unit">${esc(unit)}</div></div>`;}
  function courseCards() {
    return `<div class="course-grid">${data.courses.map(c=>{
      const s=courseStats(c.id),pct=asPercent(s.lessonDone,s.lessonTotal);
      return `<article class="course-card" data-color="${esc(c.color)}"><div class="course-card-top"><div class="course-emoji">${icons[c.color]}</div><span class="course-tag">${esc(c.level)}</span></div><div><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p></div><div><div class="progress-meta"><span>Tiến độ học tập</span><strong>${pct}%</strong></div><div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Tiến độ ${esc(c.title)}"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-meta" style="margin-top:8px"><span>${s.lessonDone}/${s.lessonTotal} bài học</span><span>${s.exerciseTotal} bài tập HTML</span></div></div><div class="course-actions"><a class="btn btn-outline btn-small" href="${libraryUrl(c.id)}">Bài tập ↗</a><a class="btn btn-small" href="${progressUrl(c.id)}">Theo dõi →</a></div></article>`;
    }).join('')}</div>`;
  }
  function filterChip(key,label,active,action) {
    return `<button class="chip ${active===key?'active':''}" data-action="${action}" data-filter="${key}" type="button" aria-pressed="${active===key}">${esc(label)}</button>`;
  }
  function renderLibraryPage() {
    document.getElementById('page-main').innerHTML=`<section class="hero"><div class="hero-copy"><div class="eyebrow">YOUR ENGLISH LEARNING SPACE</div><h1>Học mỗi ngày.<br>Tiến bộ từng bài.</h1><p>180 file bài tập trong 3 khóa học, mở bài HTML gốc và theo dõi tiến độ qua Google Sheets.</p><div class="hero-actions"><a href="#progress" class="btn btn-light">◷ Xem tiến độ</a><a href="#library?scroll=1" class="btn btn-outline-light">Khám phá bài tập ↓</a></div></div><div class="hero-art" aria-hidden="true">📚</div></section>
      <div id="library-stats"></div>
      <section aria-labelledby="course-head"><div class="section-heading"><div><h2 id="course-head">Khóa học của bạn</h2><p>Học theo nội dung gốc trong từng khóa.</p></div></div><div id="course-cards"></div></section>
      <section id="exercise-catalog" aria-labelledby="library-head"><div class="section-heading"><div><h2 id="library-head">Thư viện bài tập</h2><p>Mở HTML gốc trong tab mới. Chỉ đánh dấu “Đã làm” khi bạn thực sự hoàn thành.</p></div><div class="count-label" id="library-count"></div></div>
      <div class="toolbar"><label class="sr-only" for="library-course">Chọn khóa học</label><select id="library-course" data-action="library-course"><option value="all">Tất cả khóa học</option>${data.courses.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select><div class="search"><span class="glass">⌕</span><input id="library-search" data-action="library-search" type="search" autocomplete="off" placeholder="Tìm tên bài tập, nhóm bài..."></div><div class="filter-chips" id="library-chips"></div></div>
      <div id="library-results"></div></section>`;
    document.getElementById('library-course').value=courseFilter;
    renderLibrarySummary();renderLibraryCatalog();
  }
  function renderLibrarySummary() {
    document.getElementById('library-stats').innerHTML=statsHtml(courseStats('all'));
    document.getElementById('course-cards').innerHTML=courseCards();
  }
  function getExpandedKeys(root) {
    if (!hasCatalogRendered && !hasProgressListRendered) return null;
    return new Set([...document.querySelectorAll(`${root} details.section-card[open]`)].map(d=>d.dataset.key));
  }
  function renderLibraryCatalog() {
    const expanded=hasCatalogRendered?getExpandedKeys('#library-results'):null;
    document.getElementById('library-chips').innerHTML=[
      filterChip('all','Tất cả',exerciseFilter,'library-filter'),
      filterChip('exercise','Bài tập',exerciseFilter,'library-filter'),
      filterChip('quiz','Trắc nghiệm',exerciseFilter,'library-filter'),
      filterChip('todo','Chưa làm',exerciseFilter,'library-filter'),
      filterChip('done','Đã làm',exerciseFilter,'library-filter')].join('');
    const q=librarySearch.trim().toLowerCase();
    const list=data.exercises.filter(e=>
      (courseFilter==='all'||e.courseId===courseFilter) &&
      (exerciseFilter==='all'||(exerciseFilter==='todo'&&!isExerciseDone(e.id))||(exerciseFilter==='done'&&isExerciseDone(e.id))||e.kind===exerciseFilter) &&
      (!q||[e.title,e.section,lessonsById.get(e.lessonId)?.title||''].join(' ').toLowerCase().includes(q)));
    document.getElementById('library-count').textContent=`${list.length}/${data.exercises.length} bài tập`;
    const groups=new Map();
    for(const e of list){const key=e.courseId+'|'+e.section; if(!groups.has(key))groups.set(key,{key,courseId:e.courseId,section:e.section,order:e.sectionOrder,items:[]});groups.get(key).items.push(e);}
    const ordered=[...groups.values()].sort((a,b)=>data.courses.findIndex(x=>x.id===a.courseId)-data.courses.findIndex(x=>x.id===b.courseId)||a.order-b.order||a.section.localeCompare(b.section));
    const result=ordered.map((g,i)=>{
      const c=data.courses.find(x=>x.id===g.courseId),done=g.items.filter(e=>isExerciseDone(e.id)).length;
      const displayCourse=courseFilter==='all'?` · ${c.level}`:'';
      const isOpen=q?true:expanded?expanded.has(g.key):i===0;
      return `<details class="section-card" data-key="${esc(g.key)}" ${isOpen?'open':''}><summary><span class="section-index">${String(g.order).padStart(2,'0')}</span><span class="section-labels"><strong>${esc(g.section)}${esc(displayCourse)}</strong><small>${g.items.length} bài tập · ${done} đã hoàn thành</small></span><span class="chev">⌄</span></summary><div class="section-content">${g.items.map(e=>{
        const done=isExerciseDone(e.id),linked=lessonsById.get(e.lessonId),kind=e.kind==='quiz'?'Trắc nghiệm':'Bài tập';
        return `<div class="exercise-row"><div class="row-title"><strong><span class="file-kind ${e.kind}">${kind}</span>${esc(e.title)}</strong><small>${linked&&linked.title.toLowerCase()!==e.title.toLowerCase()?`Gắn với: ${esc(linked.title)} · `:''}${esc(e.fileName)}</small></div><div class="row-actions"><a class="open-link" href="${encodedPath(e.path)}" target="_blank" rel="noopener noreferrer" title="Mở HTML gốc">Mở bài ↗</a><button class="check-action ${done?'done':''}" type="button" data-action="toggle-exercise" data-id="${esc(e.id)}" aria-pressed="${done}" ${canEdit() ? '' : 'disabled title="K\u1ebft n\u1ed1i Google Sheets \u0111\u1ec3 l\u01b0u ti\u1ebfn \u0111\u1ed9"'}><span class="checkbox-symbol">${done?'☑':'☐'}</span>${done?'Đã làm':'Đánh dấu'}</button></div></div>`;
      }).join('')}</div></details>`;
    }).join('');
    document.getElementById('library-results').innerHTML=result||`<div class="empty"><b>Không tìm thấy bài tập</b>Thử chọn khóa học khác hoặc xóa từ khóa tìm kiếm.</div>`;
    hasCatalogRendered=true;
  }
  function renderProgressPage() {
    document.getElementById('page-main').innerHTML=`<div id="progress-hero"></div><div id="progress-stats"></div>
      <section aria-labelledby="progress-heading"><div class="section-heading progress-section-top"><div><h2 id="progress-heading">Danh s\u00e1ch b\u00e0i h\u1ecdc</h2><p>N\u1ed9i dung b\u00e0i h\u1ecdc l\u1ea5y t\u1eeb course_content.txt, bao g\u1ed3m c\u1ea3 b\u00e0i kh\u00f4ng c\u00f3 HTML.</p></div><div class="progress-course-select"><label class="sr-only" for="progress-course">Ch\u1ecdn kh\u00f3a h\u1ecdc</label><select class="control-select" data-action="progress-course" id="progress-course">${data.courses.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select></div></div>
      <div class="toolbar"><div class="search"><span class="glass">\u2315</span><input type="search" id="progress-search" data-action="progress-search" placeholder="T\u00ecm b\u00e0i h\u1ecdc theo t\u00ean..."></div><div class="filter-chips" id="progress-chips"></div><span id="progress-count" class="count-label"></span></div>
      <div id="progress-results"></div></section>
      <div class="notice"><strong>Google Sheets l\u00e0 ngu\u1ed3n d\u1eef li\u1ec7u duy nh\u1ea5t.</strong> B\u1ea1n c\u1ea7n \u0111\u0103ng nh\u1eadp \u0111\u1ec3 \u0111\u1ecdc ho\u1eb7c s\u1eeda ti\u1ebfn \u0111\u1ed9. Kh\u00f4ng l\u01b0u trong localStorage, IndexedDB hay file JSON. B\u00e0i t\u1eadp HTML g\u1ed1c \u0111\u01b0\u1ee3c gi\u1eef nguy\u00ean; \u0111\u00e1nh d\u1ea5u ho\u00e0n th\u00e0nh th\u1ee7 c\u00f4ng.</div>`;
    document.getElementById('progress-course').value=progressCourse;
    renderProgressSummary();renderProgressList();
  }
  function renderProgressSummary() {
    const c=data.courses.find(x=>x.id===progressCourse);
    const s=courseStats(progressCourse),pct=asPercent(s.lessonDone,s.lessonTotal);
    const next=data.lessons.find(l=>l.courseId===c.id&&getLessonStatus(l.id)!=='done');
    document.getElementById('progress-hero').innerHTML=`<div class="progress-hero"><div><div class="eyebrow">PERSONAL LEARNING TRACKER</div><h1>${esc(c.title)}</h1><p>${esc(c.description)} · ${s.lessonTotal} bài học theo course_content.txt, ${s.exerciseTotal} file HTML.</p><div class="hero-actions" style="margin-top:15px"><a class="btn btn-small" href="${next?progressUrl(c.id,next.id):libraryUrl(c.id)}">${next?'Tiếp tục: bài '+next.index+' →':'Xem bài tập →'}</a><a class="btn btn-outline btn-small" href="${libraryUrl(c.id)}">Mở thư viện bài tập ↗</a></div></div><div class="progress-ring" style="--pct:${pct}%"><div class="progress-ring-inner"><strong>${pct}%</strong><small>hoàn thành</small></div></div></div>`;
    document.getElementById('progress-stats').innerHTML=statsHtml(s);
  }
  function renderProgressList() {
    const expanded=hasProgressListRendered?getExpandedKeys('#progress-results'):null;
    document.getElementById('progress-chips').innerHTML=[
      filterChip('all','Tất cả',lessonFilter,'lesson-filter'),
      filterChip('todo','Chưa học',lessonFilter,'lesson-filter'),
      filterChip('doing','Đang học',lessonFilter,'lesson-filter'),
      filterChip('done','Đã học',lessonFilter,'lesson-filter')].join('');
    const q=lessonSearch.toLowerCase().trim();
    const list=data.lessons.filter(l=>l.courseId===progressCourse&&(lessonFilter==='all'||getLessonStatus(l.id)===lessonFilter)&&(!q||[l.title,l.section].join(' ').toLowerCase().includes(q)));
    document.getElementById('progress-count').textContent=`${list.length} bài học`;
    const groups=new Map();
    for(const l of list){const key=l.section;if(!groups.has(key))groups.set(key,{section:l.section,order:l.sectionOrder,items:[]});groups.get(key).items.push(l);}
    const ordered=[...groups.values()].sort((a,b)=>a.order-b.order||a.section.localeCompare(b.section));
    const target=params.get('lesson');
    document.getElementById('progress-results').innerHTML=ordered.map((g,i)=>{
      const done=g.items.filter(l=>getLessonStatus(l.id)==='done').length;
      const hasTarget=!!target&&g.items.some(l=>l.id===target);
      const open=hasTarget||q||lessonFilter!=='all'||(expanded?expanded.has(g.section):i===0);
      const isBonus=g.order===999;
      return `<details class="section-card" data-key="${esc(g.section)}" ${open?'open':''}><summary><span class="section-index">${isBonus?'✦':String(g.order).padStart(2,'0')}</span><span class="section-labels"><strong>${esc(g.section)}</strong><small>${g.items.length} bài học · ${done} đã học</small></span><span class="chev">⌄</span></summary><div class="section-content">${g.items.map(l=>{
        const state=getLessonStatus(l.id),ex=l.exerciseIds.map(id=>exercisesById.get(id)).filter(Boolean),name=l.title;
        return `<div id="${esc(l.id)}" class="lesson-row ${state==='done'?'done-row':''} ${target===l.id?'highlight-row':''}"><span class="lesson-index">${l.index}</span><div class="row-title"><span class="lesson-name">${esc(name)}</span><div class="lesson-duration">${l.duration?'⏱ '+esc(l.duration):'Không ghi thời lượng'} · ${ex.length?ex.length+' bài tập liên kết':'Chưa có HTML tương ứng'}</div>${ex.length?`<div class="lesson-links">${ex.map(e=>`<a href="${encodedPath(e.path)}" target="_blank" rel="noopener noreferrer" class="open-link" title="Mở ${esc(e.fileName)}">${esc(e.title)} ↗${isExerciseDone(e.id)?' ✓':''}</a>`).join('')}</div>`:''}</div><div class="row-actions"><label class="sr-only" for="status-${esc(l.id)}">Trạng thái ${esc(l.title)}</label><select id="status-${esc(l.id)}" class="status-select" data-action="lesson-status" data-id="${esc(l.id)}" data-status="${state}" ${canEdit() ? '' : 'disabled'} aria-label="Trạng thái của ${esc(l.title)}"><option value="todo" ${state==='todo'?'selected':''}>○ Chưa học</option><option value="doing" ${state==='doing'?'selected':''}>◐ Đang học</option><option value="done" ${state==='done'?'selected':''}>✓ Đã học</option></select></div></div>`;
      }).join('')}</div></details>`;
    }).join('')||`<div class="empty"><b>Không có bài học phù hợp</b>Hãy thử bộ lọc khác hoặc xóa từ khóa.</div>`;
    hasProgressListRendered=true;
  }
  function refreshAfterWrite() {
    if (page === 'library') { renderLibrarySummary();renderLibraryCatalog(); }
    else { renderProgressSummary();renderProgressList(); }
  }
  async function updateLesson(id, status) {
    if (!lessonIds.has(id) || !['todo','doing','done'].includes(status) || !canEdit()) {
      refreshAfterWrite();
      return;
    }
    writeBusy = true;
    renderSaveIndicator();
    try {
      const {updatedAt} = await sheets.setStatus('lesson', id, status);
      progress.lessons[id] = {status,updatedAt};
      lastError = '';
      toast('\u0110\u00e3 l\u01b0u ti\u1ebfn \u0111\u1ed9 tr\u00ean Google Sheets.');
    } catch (error) {
      lastError = error.message;
      if (!sheets.connected) progress = blankProgress();
      toast('L\u01b0u th\u1ea5t b\u1ea1i: ' + error.message);
    } finally {
      writeBusy = false;
      refreshAfterWrite();
      renderSaveIndicator();renderConnectionBanner();
    }
  }
  async function updateExercise(id) {
    if (!exerciseIds.has(id) || !canEdit()) return;
    writeBusy = true;
    renderSaveIndicator();
    try {
      const completed = !isExerciseDone(id);
      const {updatedAt} = await sheets.setStatus('exercise', id, completed ? 'done' : 'todo');
      progress.exercises[id] = {completed,updatedAt};
      lastError = '';
      toast('\u0110\u00e3 l\u01b0u ti\u1ebfn \u0111\u1ed9 tr\u00ean Google Sheets.');
    } catch (error) {
      lastError = error.message;
      if (!sheets.connected) progress = blankProgress();
      toast('L\u01b0u th\u1ea5t b\u1ea1i: ' + error.message);
    } finally {
      writeBusy = false;
      refreshAfterWrite();
      renderSaveIndicator();renderConnectionBanner();
    }
  }
  document.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.tagName === 'SELECT' || btn.tagName === 'INPUT') return;
    const action = btn.dataset.action;
    if (action === 'google-login') sheets.connect();
    if (action === 'sheet-refresh' && !writeBusy) sheets.refresh();
    if (action === 'sheet-disconnect') sheets.disconnect();
    if (action === 'library-filter') { exerciseFilter = btn.dataset.filter; renderLibraryCatalog(); }
    if (action === 'lesson-filter') { lessonFilter = btn.dataset.filter; renderProgressList(); }
    if (action === 'toggle-exercise') updateExercise(btn.dataset.id);
  });
  document.addEventListener('change',ev=>{
    const el=ev.target,action=el.dataset.action;
    if(action==='library-course'){courseFilter=el.value;hasCatalogRendered=false;renderLibraryCatalog();}
    if(action==='progress-course'){
      if(!allCourseIds.has(el.value))return;
      progressCourse=el.value;hasProgressListRendered=false;lessonFilter='all';lessonSearch='';
      const search=document.getElementById('progress-search');if(search)search.value='';
      try{history.replaceState(null,'',progressUrl(progressCourse));}catch(_){}
      renderProgressSummary();renderProgressList();
    }
    if(action==='lesson-status')updateLesson(el.dataset.id,el.value);

  });
  document.addEventListener('input',ev=>{
    if(ev.target.dataset.action==='library-search'){librarySearch=ev.target.value;renderLibraryCatalog();}
    if(ev.target.dataset.action==='progress-search'){lessonSearch=ev.target.value;renderProgressList();}
  });
  window.addEventListener('hashchange', () => {
    route = parseRoute();
    page = route.view;
    params = route.params;
    if (page === 'library') {
      courseFilter = allCourseIds.has(params.get('course')) ? params.get('course') : 'all';
      hasCatalogRendered = false;
    } else {
      progressCourse = allCourseIds.has(params.get('course')) ? params.get('course') : progressCourse;
      hasProgressListRendered = false;
    }
    renderFullApp();
    if (params.get('scroll') !== '1' && !params.get('lesson')) window.scrollTo(0, 0);
  });
  renderFullApp();

})();
