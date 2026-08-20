// =============================
// Aqua Alert – JS revisado & otimizado
// =============================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// --- Persistência ---
const storage = {
    get(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback } 
        catch { return fallback }
    },
    set(key, val) {
        localStorage.setItem(key, JSON.stringify(val))
    }
}

// --- Estado da aplicação ---
const state = {
    sensors: storage.get('aa:sensors', [
        { id: 'kitchen', name: 'Cozinha', location: 'Apto', active: true },
        { id: 'bath', name: 'Banheiro', location: 'Apto', active: true },
        { id: 'tank', name: 'Caixa d\'água', location: 'Cobertura', active: true },
    ]),
    readings: storage.get('aa:readings', []), // {time, sensor, flow, tds}
    alerts: storage.get('aa:alerts', []), // {id, time, type, title, detail, sensor}
    cfg: storage.get('aa:cfg', { leakFlow: 2, leakMins: 30 }),
    sort: { table: { key: 'time', dir: 'desc' } }
};

const now = () => Date.now();
const fmtTime = (d) => new Date(d).toLocaleString();

function saveAll() {
    storage.set('aa:sensors', state.sensors);
    storage.set('aa:readings', state.readings);
    storage.set('aa:alerts', state.alerts);
    storage.set('aa:cfg', state.cfg);
}

// --- Toasts ---
function toast(msg, type = 'info', duration = 4000) {
    const c = $('#toast');
    if (!c) return;
    const item = document.createElement('div');
    item.className = `item ${type}`;
    item.textContent = msg;
    c.appendChild(item);
    setTimeout(() => {
        item.style.opacity = '0';
        item.style.transform = 'translateY(10px)';
        setTimeout(() => item.remove(), 300);
    }, duration);
}

// --- Modal ---
function openModal(title, bodyHTML) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modal').classList.add('show');
}
function closeModal() {
    $('#modal').classList.remove('show');
}

// Evita múltiplos listeners
$('#closeModal')?.addEventListener('click', closeModal);
$('#modal')?.addEventListener('click', (e) => { if(e.target.id==='modal') closeModal(); });

// --- Tema ---
const body = document.body;
const html = document.documentElement;
const themeSelect = $('#themeSelect');

function applyTheme(theme) {
    html.className = '';
    body.className = '';
    html.classList.add(`theme-${theme}`);
    body.classList.add(`theme-${theme}`);
    storage.set('aa:theme', theme);
    drawChart();
}

function loadSavedTheme() {
    const saved = storage.get('aa:theme', 'dark');
    applyTheme(saved);
    if (themeSelect) themeSelect.value = saved;
}

themeSelect?.addEventListener('change', (e) => applyTheme(e.target.value));

// --- Router simples ---
function routeTo(key) {
    $$('.section').forEach(s => s.classList.add('hidden'));
    $(`#view-${key}`)?.classList.remove('hidden');
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === key));
}
$$('.nav a').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    routeTo(a.dataset.route);
}));
$('#themeBtn')?.addEventListener('click', () => routeTo('config'));

// --- Sensores ---
function renderSensors() {
    const wrap = $('#sensorsList');
    if(!wrap) return;
    wrap.innerHTML = '';
    state.sensors.forEach(s => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
        <div class="card-header">
            <div>
                <div class="card-title">${s.name}</div>
                <div class="card-sub">${s.location}</div>
            </div>
            <div class="flex">
                <label class="badge ${s.active?'ok':'crit'}">${s.active?'Ativo':'Inativo'}</label>
                <button class="btn" data-act="toggle">${s.active?'Desativar':'Ativar'}</button>
                <button class="btn danger" data-act="remove">Remover</button>
            </div>
        </div>`;
        card.querySelector('[data-act="toggle"]')?.addEventListener('click', () => {
            s.active = !s.active;
            saveAll();
            renderSensors();
            toast(`Sensor ${s.name} ${s.active?'ativado':'desativado'}`, s.active?'ok':'warn');
        });
        card.querySelector('[data-act="remove"]')?.addEventListener('click', () => {
            if(confirm('Remover sensor?')) {
                state.sensors = state.sensors.filter(x => x.id !== s.id);
                saveAll();
                renderSensors();
                toast('Sensor removido', 'crit');
            }
        });
        wrap.appendChild(card);
    });
}

$('#addSensorBtn')?.addEventListener('click', () => {
    openModal('Novo Sensor', `
      <div class="grid-2">
        <div><small class="card-sub">Nome</small><input id="nsName" class="input" placeholder="Ex: Cozinha" /></div>
        <div><small class="card-sub">ID (único)</small><input id="nsId" class="input" placeholder="ex: kitchen" /></div>
        <div><small class="card-sub">Local</small><input id="nsLoc" class="input" placeholder="Ex: Apto" /></div>
      </div>
      <div class="mt-16"><button id="nsSave" class="btn primary">Salvar</button></div>
    `);
    $('#nsSave')?.addEventListener('click', () => {
        const id = $('#nsId')?.value.trim();
        const name = $('#nsName')?.value.trim();
        const loc = $('#nsLoc')?.value.trim() || '-';
        if (!id || !name) return toast('Preencha pelo menos ID e Nome', 'warn');
        if (state.sensors.some(s => s.id === id)) return toast('ID já existe', 'crit');
        state.sensors.push({ id, name, location: loc, active: true });
        saveAll();
        closeModal();
        renderSensors();
        toast('Sensor adicionado', 'ok');
    });
});

// --- Export/Import ---
$('#exportBtn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ sensors: state.sensors, readings: state.readings, alerts: state.alerts, cfg: state.cfg }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'aqua-alert-backup.json'; a.click();
    URL.revokeObjectURL(url);
});
$('#importFile')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            state.sensors = data.sensors ?? state.sensors;
            state.readings = data.readings ?? state.readings;
            state.alerts = data.alerts ?? state.alerts;
            state.cfg = data.cfg ?? state.cfg;
            saveAll();
            renderAll();
            toast('Backup importado com sucesso', 'ok');
        } catch { toast('Arquivo inválido', 'crit'); }
    };
    reader.readAsText(file);
});

// --- Leituras & Lógica de Vazamento ---
function addReading(partial = {}) {
    const active = state.sensors.filter(s => s.active);
    if(active.length === 0) return toast('Nenhum sensor ativo', 'warn');
    const s = active[Math.floor(Math.random() * active.length)];
    const flow = partial.flow ?? +(Math.random() * 5).toFixed(2);
    const tds = partial.tds ?? Math.floor(80 + Math.random() * 120);
    const r = { time: now(), sensor: partial.sensor ?? s.id, flow, tds };
    state.readings.unshift(r);
    saveAll();
    evaluateLeak();
    renderDashboard();
    renderHistory();
}

function evaluateLeak() {
    const thr = state.cfg.leakFlow;
    const mins = state.cfg.leakMins;
    const cutoff = now() - mins * 60 * 1000;
    const recent = state.readings.filter(r => r.time >= cutoff);
    const grouped = recent.reduce((acc, r) => ((acc[r.sensor] ??= []).push(r), acc), {});
    Object.entries(grouped).forEach(([sensor, arr]) => {
        const above = arr.filter(r => r.flow >= thr);
        if(above.length >= Math.max(3, Math.floor(mins/5))) {
            const exists = state.alerts.some(a => a.type==='crit' && a.sensor===sensor && (now()-a.time)<3600000);
            if(!exists) {
                const id = crypto.randomUUID();
                state.alerts.unshift({ id, sensor, time: now(), type:'crit', title:'Possível Vazamento detectado', detail:`Fluxo acima de ${thr} L/min por ${mins} min.` });
                saveAll();
                toast('🚨 Possível Vazamento detectado!', 'crit');
                renderAlerts();
            }
        }
    });
}

// --- Estatísticas ---
function computeStats() {
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const usageToday = state.readings.filter(r=>r.time>=startOfDay.getTime()).reduce((sum,r)=>sum+r.flow/60,0);
    const leaks24 = state.alerts.filter(a=>a.type==='crit' && a.time>=now()-86400000).length;
    return { usageToday: Math.round(usageToday), leaks24 };
}

// --- Render: Dashboard ---
function renderAlerts() {
    const wrap = $('#alertsList'); if(!wrap) return; wrap.innerHTML='';
    state.alerts.slice(0,10).forEach(a => {
        const el = document.createElement('div');
        el.className='alert';
        el.innerHTML=`
            <div class="pill ${a.type==='crit'?'crit':a.type==='warn'?'warn':'ok'}"></div>
            <div>
                <strong>${a.title}</strong>
                <div class="meta">${fmtTime(a.time)} • Sensor: ${a.sensor}</div>
            </div>`;
        el.addEventListener('click', () => {
            openModal(a.title, `
                <p><strong>Sensor:</strong> ${a.sensor}</p>
                <p><strong>Data:</strong> ${fmtTime(a.time)}</p>
                <p><strong>Detalhe:</strong> ${a.detail||'-'}</p>
                <div class="mt-16"><button id="dismissAlert" class="btn">Descartar alerta</button></div>
            `);
            $('#dismissAlert')?.addEventListener('click', () => {
                state.alerts = state.alerts.filter(x=>x.id!==a.id);
                saveAll();
                renderAlerts();
                closeModal();
                toast('Alerta descartado', 'ok');
            });
        });
        wrap.appendChild(el);
    });
}

function renderDashboard() {
    const s = computeStats();
    $('[data-bind="usage"]').textContent = s.usageToday+' L';
    $('[data-bind="leaks"]').textContent = s.leaks24;
    $('#stat-usage')?.classList.add(s.usageToday>500?'warn':'ok');
    $('#stat-leak')?.classList.add(s.leaks24>0?'crit':'ok');
    drawChart();
    renderAlerts();
}

// --- Render: Gráfico ---
function drawChart() {
    const cvs = $('#usageChart'); if(!cvs) return;
    const ctx = cvs.getContext('2d');
    const W=cvs.width=cvs.clientWidth, H=cvs.height;
    ctx.clearRect(0,0,W,H);
    const buckets=Array.from({length:24},(_,i)=>({h:i,v:0}));
    const since = now()-86400000;
    state.readings.filter(r=>r.time>=since).forEach(r=>buckets[new Date(r.time).getHours()].v+=r.flow/60);
    const max = Math.max(10, ...buckets.map(b=>b.v));
    ctx.globalAlpha=0.5; ctx.lineWidth=1;
    ctx.strokeStyle=getComputedStyle(body).getPropertyValue('--muted')||'#9fb3c866';
    for(let i=0;i<=4;i++){ const y=H-(H*(i/4)); ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();}
    ctx.globalAlpha=1;
    const pad=20,bw=(W-pad*2)/24*0.7,gap=(W-pad*2)/24*0.3;
    buckets.forEach((b,i)=>{ const x=pad+i*(bw+gap); const h=Math.max(2,(b.v/max)*(H-20)); ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--brand-2')||'#22c1a9'; ctx.fillRect(x,H-h,bw,h); });
}

// --- Render: Histórico ---
const page = { size:10, index:1 };
function renderHistory() {
    const tbody=$('#historyTable tbody'); if(!tbody) return;
    const q = ($('#historySearch')?.value.toLowerCase() || $('#globalSearch')?.value.toLowerCase()) ?? '';
    let rows = state.readings.map(r=>({
        time:r.time,sensor:r.sensor,flow:r.flow,tds:r.tds,status:r.flow>=state.cfg.leakFlow?'Alto':'Normal'
    }));
    if(q) rows=rows.filter(r=>Object.values(r).some(v=>String(v).toLowerCase().includes(q)));
    const {key,dir}=state.sort.table;
    rows.sort((a,b)=>(a[key]>b[key]?1:-1)*(dir==='asc'?1:-1));
    const total=rows.length, pages=Math.max(1,Math.ceil(total/page.size));
    if(page.index>pages) page.index=pages;
    const start=(page.index-1)*page.size;
    const slice=rows.slice(start,start+page.size);
    tbody.innerHTML='';
    slice.forEach(r=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`<td>${fmtTime(r.time)}</td><td>${r.sensor}</td><td>${r.flow.toFixed(2)}</td><td>${r.tds}</td><td><span class="badge ${r.status==='Alto'?'warn':'ok'}">${r.status}</span></td>`;
        tbody.appendChild(tr);
    });
    const pag=$('#pagination'); if(!pag) return; pag.innerHTML='';
    const btn=(label,idx,disabled=false)=>{ const b=document.createElement('button'); b.className='btn'; b.textContent=label; if(disabled) b.disabled=true; b.addEventListener('click',()=>{page.index=idx; renderHistory();}); return b;}
    pag.appendChild(btn('«',1,page.index===1));
    for(let i=1;i<=pages && i<=6;i++) pag.appendChild(btn(String(i),i,page.index===i));
    pag.appendChild(btn('»',pages,page.index===pages));
}

$$('#historyTable thead th').forEach(th=>th.addEventListener('click',()=>{
    const k=th.dataset.sort; const st=state.sort.table;
    if(st.key===k){ st.dir=st.dir==='asc'?'desc':'asc'; } else { st.key=k; st.dir='desc'; }
    renderHistory();
}));

// --- Filtros ---
function onSearch(){ renderAlerts(); renderHistory(); }
$('#globalSearch')?.addEventListener('input', debounce(onSearch,200));
$('#historySearch')?.addEventListener('input', debounce(onSearch,200));
function debounce(fn,ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),ms); }}

// --- Botões ---
$('#newReadingBtn')?.addEventListener('click',()=>addReading());
$('#clearAlerts')?.addEventListener('click',()=>{
    state.alerts=[]; saveAll(); renderAlerts(); toast('Alertas limpos','ok');
});
$('#saveCfg')?.addEventListener('click',()=>{
    state.cfg.leakFlow=parseFloat($('#cfgLeakFlow')?.value)||2;
    state.cfg.leakMins=parseInt($('#cfgLeakMins')?.value)||30;
    saveAll(); toast('Configurações salvas','ok'); evaluateLeak(); renderDashboard();
});

// --- Importa cfg para formulário ---
function hydrateCfg() { $('#cfgLeakFlow')?.value=state.cfg.leakFlow; $('#cfgLeakMins')?.value=state.cfg.leakMins; }

// --- Inicialização ---
function renderAll(){ renderSensors(); renderDashboard(); renderHistory(); hydrateCfg(); }
loadSavedTheme();

// semente inicial se vazio
if(state.readings.length===0){
    for(let i=0;i<60;i++){
        const t=now()-Math.floor(Math.random()*24*60)*60*1000;
        const sensor=state.sensors[Math.floor(Math.random()*state.sensors.length)].id;
        state.readings.push({ time:t, sensor, flow:+(Math.random()*4).toFixed(2), tds:Math.floor(90+Math.random()*180) });
    }
    state.readings.sort((a,b)=>b.time-a.time);
}
saveAll(); renderAll();

// simulação contínua opcional (comentar se não quiser)
const sim=setInterval(()=>addReading(),8000);

// Eventos globais
window.addEventListener('resize',drawChart);
window.addEventListener('DOMContentLoaded',()=>{ toast('Bem-vindo ao Aqua Alert 🌊','info',3000); routeTo('dashboard'); });

// Remove animação de água depois de carregar
window.addEventListener('load',()=>{
    const water = document.getElementById('waterTransition');
    if(water) setTimeout(()=>{ water.style.transition='top 1s ease'; water.style.top='-100%'; },800);
});
