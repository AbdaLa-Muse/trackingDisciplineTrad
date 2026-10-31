(() => {
'use strict'

const CONFIG = window.TRADEFLOW_CONFIG || {}
const SESSION_KEY = 'tradeflow_cloud_session_v1'
const THEME_CACHE_KEY = 'tradeflow_cloud_theme_v1'
const LEGACY_REVIEWS_KEY = 'tradeflow_simple_reviews_v1'
const LEGACY_PREFS_KEY = 'tradeflow_simple_preferences_v1'
const LEGACY_THEME_KEY = 'tradeflow_simple_theme_v1'
const BACKUP_SCHEMA = 'tradeflow-supabase-backup'
const SCHEMA_VERSION = 10

const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const now = new Date()
const state = {
  unlocked: false,
  reviews: [],
  accounts: [],
  accountRisks: [],
  accountResets: [],
  goals: [],
  goalsError: '',
  settings: { officialStartDate: '2026-10-22', theme: 'dark' },
  draft: { risk: null, strategy: null, setup: null, result: null, accountRisks: [] },
  reviewDate: localDateKey(),
  page: 'dashboard',
  range: '30',
  calendarMonth: new Date(now.getFullYear(), now.getMonth(), 1),
  filters: { result: 'all', discipline: 'all' },
  pendingImport: null,
  inactivityTimer: null,
}

function configReady() {
  return /^https:\/\/.+\.supabase\.co$/i.test(CONFIG.SUPABASE_URL || '') &&
    /^sb_(publishable|anon)_/i.test(CONFIG.SUPABASE_PUBLISHABLE_KEY || '')
}
function sessionToken() { return sessionStorage.getItem(SESSION_KEY) || '' }
function setSession(token) { if (token) sessionStorage.setItem(SESSION_KEY, token); else sessionStorage.removeItem(SESSION_KEY) }
function setSync(text, type = '') { const el = $('#syncStatus'); if (!el) return; el.textContent = text; el.className = `sync-pill ${type}` }
function showLoading(text = 'Loading TradeFlow…') { $('#loadingText').textContent = text; $('#loadingOverlay').classList.add('show') }
function hideLoading() { $('#loadingOverlay').classList.remove('show') }
function localDateKey(d = new Date()) { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
function parseKey(k) { const [y,m,d]=String(k).split('-').map(Number); return new Date(y,m-1,d) }
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function isWeekendDate(d){const day=d.getDay();return day===0||day===6}
function validDateKey(k){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(k)))return false;const x=parseKey(k);return !Number.isNaN(x.getTime())&&localDateKey(x)===k}
function validDiscipline(v){return v==='followed'||v==='broke'}
function validSetup(v){return ['setup_1','setup_2','setup_3','setup_4'].includes(v)}
function setupShort(v){return v==='setup_1'?'Setup 1':v==='setup_2'?'Setup 2':v==='setup_3'?'Setup 3':v==='setup_4'?'Setup 4':'—'}
function setupLabel(v){return v==='setup_1'?'Setup 1 — 5M Break + Gap / Breaker Block':v==='setup_2'?'Setup 2 — 5M Inducement + Liquidity Sweep':v==='setup_3'?'Setup 3 — Consolidation Sweep + Structure Break':v==='setup_4'?'Setup 4 — Multi-Timeframe Alignment + Gap':'N/A'}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function accountById(id){return state.accounts.find(a=>a.id===id)||null}
function reviewAccountRisks(date){return state.accountRisks.filter(x=>x.review_date===date)}
function normalizeAccountRisk(x){
  const risk=Number(x?.risk_pct),ret=x?.trade_return_pct==null?null:Number(x.trade_return_pct)
  return x&&x.account_id&&validDateKey(x.review_date)&&[1,2].includes(risk)?{account_id:x.account_id,review_date:x.review_date,risk_pct:risk,trade_return_pct:Number.isFinite(ret)?ret:null,violated:!!x.violated,created_at:x.created_at||null}:null
}
function normalizeAccount(a){if(!a||!a.id)return null;const size=Number(a.account_size);return {...a,account_size:Number.isFinite(size)&&size>0?size:null,active:a.active!==false}}
function normalizeReset(x){return x&&x.account_id&&validDateKey(x.reset_date)?{id:x.id||null,account_id:x.account_id,reset_date:x.reset_date,created_at:x.created_at||null,is_explicit:x.is_explicit===true}:null}
function normalizeGoal(g){
  if(!g||!g.id||!String(g.title||'').trim())return null
  const status=g.status==='completed'?'completed':'active'
  return {id:String(g.id),title:String(g.title).trim(),status,created_at:g.created_at||null,completed_at:g.completed_at||null}
}
function normalizeGoals(list){return (Array.isArray(list)?list:[]).map(normalizeGoal).filter(Boolean).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))}
function fmtGoalDate(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric'}).format(d)}
function cycleNumberFromReturn(total){return Math.max(1,Math.floor(Number(total||0)/5)+3)}
function cycleLabel(n){return n<=1?'Very High Risk':n===2?'Danger Zone':n===3?'Caution':n===4?'Growth Zone':n===5?'Strong Growth':'Expansion'}
function cycleBasePct(n){return (Math.max(1,n)-3)*5}
function cycleText(n){return `Cycle ${n>=6?'6+':n} · ${cycleLabel(n)}`}
function accountTrackingStart(accountId,targetDate='9999-12-31'){
  const resets=state.accountResets.filter(x=>x.account_id===accountId&&x.is_explicit===true&&x.reset_date<=targetDate).sort((a,b)=>a.reset_date.localeCompare(b.reset_date)||(a.created_at||'').localeCompare(b.created_at||''));
  return resets.length?resets[resets.length-1].reset_date:null
}
function simulateAccount(accountId,targetDate='9999-12-31',excludeDate=null){
  const account=accountById(accountId);
  if(!account?.account_size)return {configured:false,totalReturn:0,cycle:3,basePct:0,progressPct:0,twoUsed:false,bufferAvailable:false,status:'Not Available',safeRisk:'1%'}
  const resetDate=accountTrackingStart(accountId,targetDate);
  const rows=state.accountRisks.filter(x=>x.account_id===accountId&&(!resetDate||x.review_date>=resetDate)&&x.review_date<targetDate&&x.review_date!==excludeDate&&x.trade_return_pct!=null).sort((a,b)=>a.review_date.localeCompare(b.review_date));
  let total=0,cycle=3,twoUsed=false;
  for(const r of rows){
    const before=cycleNumberFromReturn(total);
    if(before!==cycle){cycle=before;twoUsed=false}
    if(Number(r.risk_pct)===2)twoUsed=true;
    total+=Number(r.trade_return_pct||0);
    const after=cycleNumberFromReturn(total);
    if(after!==before){cycle=after;twoUsed=false}else cycle=before;
  }
  cycle=cycleNumberFromReturn(total);
  const basePct=cycleBasePct(cycle),progressPct=total-basePct,bufferAvailable=progressPct>=2-1e-9;
  return {configured:true,totalReturn:total,cycle,basePct,progressPct,twoUsed,bufferAvailable,status:twoUsed?'Already Used':bufferAvailable?'Available':'Not Available',safeRisk:!twoUsed&&bufferAvailable?'1% or 2%':'1%'}
}
function riskReasonsForSelection(x,date,result=null){
  const reasons=[]
  if(Number(x.risk_pct)===2){
    const s=simulateAccount(x.account_id,date,date)
    if(!s.bufferAvailable)reasons.push('2% risk used before 2% buffer was available.')
    if(s.twoUsed)reasons.push('2% risk was already used in this cycle.')
  }
  const ret=Number(x.trade_return_pct),risk=Number(x.risk_pct)
  if(result==='loss'&&Number.isFinite(ret)&&Number.isFinite(risk)&&ret<0&&Math.abs(ret)>risk+1e-9){
    reasons.push('Loss exceeded the selected risk percentage.')
  }
  return reasons
}
function draftRiskStatus(d=state.draft,date=localDateKey()){
  if(d.result==='no_trade')return {risk:null,violation:false,reasons:[]}
  if(!Array.isArray(d.accountRisks)||!d.accountRisks.length)return {risk:null,violation:false,reasons:[]}
  const reasons=[];for(const x of d.accountRisks)reasons.push(...riskReasonsForSelection(x,date,d.result))
  const unique=[...new Set(reasons)]
  return {risk:unique.length?'broke':'followed',violation:!!unique.length,reasons:unique}
}
function paintRiskStatus(riskState,riskEl,warn){
  if(riskEl){riskEl.className=`overall ${riskState.risk==='broke'?'red':riskState.risk==='followed'?'green':'grey'}`;riskEl.innerHTML=riskState.risk==='broke'?'<i class="dot red"></i>Broke Rules':riskState.risk==='followed'?'<i class="dot green"></i>Followed':'<i class="dot grey"></i>N/A'}
  if(warn){warn.style.display=riskState.violation?'block':'none';warn.innerHTML=riskState.reasons.map(x=>`<div><strong>Reason:</strong> ${esc(x)}</div>`).join('')}
}
function accountRiskSummary(date){
  const rows=reviewAccountRisks(date);if(!rows.length)return '—';
  return rows.map(x=>`${esc(accountById(x.account_id)?.name||'Archived account')} · Risk ${x.risk_pct}%${x.trade_return_pct==null?'':` · Return ${x.trade_return_pct>0?'+':''}${x.trade_return_pct}%`}`).join('<br>')
}

function normalizeReview(r){
  if(!r||!validDateKey(r.date))return null
  const result=['win','loss','break_even','no_trade'].includes(r.result)?r.result:null
  let risk=validDiscipline(r.risk)?r.risk:null,strategy=validDiscipline(r.strategy)?r.strategy:null
  let setup=validSetup(r.setup)?r.setup:null
  if(result==='no_trade'){risk=null;strategy=null;setup=null}
  if(result!=='no_trade'&&(!risk||!strategy))return null
  return {id:r.id||null,date:r.date,risk,strategy,setup,result,accountManaged:!!(r.account_managed??r.accountManaged),createdAt:r.created_at||r.createdAt||null,updatedAt:r.updated_at||r.updatedAt||null}
}
function normalizeReviews(list){const map=new Map();(Array.isArray(list)?list:[]).forEach(x=>{const r=normalizeReview(x);if(r)map.set(r.date,r)});return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date))}
function getReview(date){return state.reviews.find(r=>r.date===date)||null}
function reviewDateKey(){return validDateKey(state.reviewDate)?state.reviewDate:localDateKey()}
function reviewDateAllowed(date){return validDateKey(date)&&date>=String(state.settings.officialStartDate||'2026-10-22')&&date<=localDateKey()}
function blankDraft(){return {risk:null,strategy:null,setup:null,result:null,accountRisks:[]}}
function loadDraftForDate(date){
  if(!reviewDateAllowed(date))return false
  state.reviewDate=date
  const saved=getReview(date)
  state.draft=saved?{risk:saved.risk,strategy:saved.strategy,setup:saved.setup||null,result:saved.result,accountRisks:reviewAccountRisks(date).map(x=>({account_id:x.account_id,risk_pct:x.risk_pct,trade_return_pct:x.trade_return_pct}))}:blankDraft()
  return true
}

async function rpc(name, args = {}) {
  if (!configReady()) throw new Error('Supabase is not configured yet.')
  let res
  try {
    res = await fetch(`${String(CONFIG.SUPABASE_URL).replace(/\/$/,'')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.SUPABASE_PUBLISHABLE_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(args)
    })
  } catch {
    throw new Error('Could not reach Supabase. Check your internet connection.')
  }
  const text = await res.text()
  let data = null
  if (text) { try { data = JSON.parse(text) } catch { data = text } }
  if (!res.ok) {
    const msg = data?.message || data?.hint || data?.details || 'TradeFlow request failed'
    if (/invalid or expired session/i.test(msg)) lockApp('Session expired. Enter your access code again.')
    throw new Error(msg)
  }
  resetInactivityTimer()
  return data
}

async function api(action, payload = {}) {
  const token = sessionToken()
  if (!token) throw new Error('TradeFlow is locked.')

  if (action === 'bootstrap') {
    return await rpc('tradeflow_bootstrap', { p_token: token })
  }
  if (action === 'set_theme') {
    return await rpc('tradeflow_set_theme', { p_token: token, p_theme: payload.theme })
  }
  if (action === 'upsert_review') {
    const r = payload.review
    return await rpc('tradeflow_upsert_review_v2', {
      p_token: token, p_date: r.date, p_strategy: r.strategy, p_setup: r.setup, p_result: r.result,
      p_account_risks: r.accountRisks || []
    })
  }
  if(action==='add_account') return await rpc('tradeflow_add_account_v3',{p_token:token,p_name:payload.name,p_account_size:payload.accountSize})
  if(action==='update_account') return await rpc('tradeflow_update_account_v3',{p_token:token,p_account_id:payload.id,p_name:payload.name,p_account_size:payload.accountSize})
  if(action==='reset_account') return await rpc('tradeflow_reset_account_v3',{p_token:token,p_account_id:payload.id})
  if(action==='archive_account') return await rpc('tradeflow_archive_account',{p_token:token,p_account_id:payload.id})
  if(action==='unarchive_account') return await rpc('tradeflow_unarchive_account',{p_token:token,p_account_id:payload.id})
  if (action === 'delete_review') {
    return await rpc('tradeflow_delete_review', { p_token: token, p_date: payload.date })
  }
  if (action === 'import_backup') {
    const rows = (payload.reviews || []).map(r=>({date:r.date,risk:r.risk,strategy:r.strategy,setup:r.setup||null,result:r.result}))
    return await rpc('tradeflow_import_v3', {p_token:token,p_reviews:rows,p_accounts:payload.accounts||[],p_account_risks:payload.accountRisks||[],p_account_resets:payload.accountResets||[],p_theme:['dark','light'].includes(payload.theme)?payload.theme:null})
  }
  if (action === 'migrate_local') {
    const rows = (payload.reviews || []).map(r=>({date:r.date,risk:r.risk,strategy:r.strategy,setup:r.setup||null,result:r.result}))
    return await rpc('tradeflow_import', {p_token:token,p_reviews:rows,p_theme:['dark','light'].includes(payload.theme)?payload.theme:null})
  }
  if(action==='list_goals') return await rpc('tradeflow_list_goals',{p_token:token})
  if(action==='add_goal') return await rpc('tradeflow_add_goal',{p_token:token,p_title:payload.title})
  if(action==='complete_goal') return await rpc('tradeflow_complete_goal',{p_token:token,p_goal_id:payload.id})
  if(action==='delete_goal') return await rpc('tradeflow_delete_goal',{p_token:token,p_goal_id:payload.id})
  throw new Error('Unknown TradeFlow action')
}

function applyThemeLocal(theme){
  if(!['dark','light'].includes(theme))return
  document.documentElement.dataset.theme=theme
  try{localStorage.setItem(THEME_CACHE_KEY,theme)}catch{}
  renderThemeButtons()
}
async function applyTheme(theme, sync = true){
  const previous = document.documentElement.dataset.theme || 'dark'
  applyThemeLocal(theme)
  if(!sync || !state.unlocked)return
  try { setSync('Saving theme…','busy'); await api('set_theme',{theme}); state.settings.theme=theme; setSync('Synced','ok'); toast('Theme saved') }
  catch(e){ applyThemeLocal(previous); setSync('Sync error','error'); toast(e.message || 'Could not save theme') }
}

function unlockUi(){
  state.unlocked=true
  $('#authScreen').classList.add('hidden')
  $('.app').classList.remove('is-locked')
  $('.mobile-nav').classList.remove('is-locked')
  resetInactivityTimer()
}
function lockApp(message = ''){
  state.unlocked=false
  setSession('')
  clearTimeout(state.inactivityTimer)
  $('.app').classList.add('is-locked')
  $('.mobile-nav').classList.add('is-locked')
  $('#authScreen').classList.remove('hidden')
  $('#accessCode').value=''
  $('#authError').textContent=message
  setSync('Locked')
}
function resetInactivityTimer(){
  clearTimeout(state.inactivityTimer)
  if(!state.unlocked)return
  const minutes = Math.max(5, Number(CONFIG.AUTO_LOCK_MINUTES || 30))
  state.inactivityTimer = setTimeout(()=>lockApp('TradeFlow locked after inactivity.'), minutes*60*1000)
}
;['click','keydown','touchstart'].forEach(evt=>document.addEventListener(evt,()=>{if(state.unlocked)resetInactivityTimer()},{passive:true}))

async function unlockWithCode(code){
  if(!/^\d{4}$/.test(code)){ $('#authError').textContent='Enter a 4-digit code.'; return }
  $('#authError').textContent=''; $('#unlockBtn').disabled=true; $('#unlockBtn').textContent='Checking…'
  try{
    const result = await rpc('tradeflow_unlock', { p_code: code })
    if(!result?.ok || !result?.token) throw new Error(result?.message || 'Incorrect code')
    setSession(result.token)
    unlockUi()
    toast('Access granted')
    await bootstrap()
  }catch(e){
    $('#authError').textContent=e.message || 'Incorrect code'
  }finally{ $('#unlockBtn').disabled=false; $('#unlockBtn').textContent='Unlock TradeFlow' }
}

async function bootstrap(){
  showLoading('Loading TradeFlow…'); setSync('Syncing…','busy')
  try{
    const data = await api('bootstrap')
    state.reviews = normalizeReviews(data.reviews)
    state.accounts = (Array.isArray(data.accounts)?data.accounts:[]).map(normalizeAccount).filter(Boolean)
    state.accountRisks = (Array.isArray(data.account_risks)?data.account_risks:[]).map(normalizeAccountRisk).filter(Boolean)
    state.accountResets = (Array.isArray(data.account_resets)?data.account_resets:[]).map(normalizeReset).filter(Boolean)
    state.settings = {officialStartDate:data.settings?.official_start_date || '2026-10-22', theme:data.settings?.theme || 'dark'}
    if(!reviewDateAllowed(state.reviewDate))state.reviewDate=localDateKey()
    loadDraftForDate(state.reviewDate)
    try{state.goals=normalizeGoals(await api('list_goals'));state.goalsError=''}catch(goalErr){state.goals=[];state.goalsError=goalErr?.message||'Goals database update required'}
    applyThemeLocal(state.settings.theme)
    renderAll(); setSync('Synced','ok')
  }catch(e){
    setSync('Sync error','error'); toast(e.message || 'Could not load data')
  }finally{hideLoading()}
}

function validateDraft(data){
  if(!validDateKey(data.date))return {ok:false,msg:'Invalid date'}
  if(!['win','loss','break_even','no_trade'].includes(data.result))return {ok:false,msg:'Choose a Result'}
  if(data.result==='no_trade')return {ok:true,review:{date:data.date,strategy:null,setup:null,result:'no_trade',accountRisks:[]}}
  if(!validDiscipline(data.strategy))return {ok:false,msg:'Win/Loss/Break Even requires Strategy'}
  if(!validSetup(data.setup))return {ok:false,msg:'Choose a Trading Setup'}
  const ars=Array.isArray(data.accountRisks)?data.accountRisks.filter(x=>x.account_id&&[1,2].includes(Number(x.risk_pct))):[]
  if(!ars.length)return {ok:false,msg:'Select at least one account and risk %'}
  for(const x of ars){
    const a=accountById(x.account_id);if(!a?.account_size)return {ok:false,msg:`Set Account Size for ${a?.name||'selected account'} in Settings`}
    const ret=Number(x.trade_return_pct)
    if(!Number.isFinite(ret))return {ok:false,msg:`Enter Trade Return % for ${a.name}`}
    if(data.result==='win'&&ret<=0)return {ok:false,msg:'Win requires a positive Trade Return %'}
    if(data.result==='loss'&&ret>=0)return {ok:false,msg:'Loss requires a negative Trade Return %'}
    if(data.result==='break_even'&&Math.abs(ret)>1e-9)return {ok:false,msg:'Break Even Trade Return % must be 0'}
  }
  return {ok:true,review:{date:data.date,strategy:data.strategy,setup:data.setup,result:data.result,accountRisks:ars.map(x=>({account_id:x.account_id,risk_pct:Number(x.risk_pct),trade_return_pct:Number(x.trade_return_pct)}))}}
}

async function saveReview(data){const v=validateDraft(data);if(!v.ok)throw new Error(v.msg);setSync('Saving…','busy');await api('upsert_review',{review:v.review});await bootstrap();setSync('Synced','ok');return getReview(v.review.date)}
async function deleteReview(date){
  setSync('Deleting…','busy'); await api('delete_review',{date}); await bootstrap(); setSync('Synced','ok')
}

function overall(r){if(!r)return {key:'none',label:'No Review',color:'grey'};if(r.result==='no_trade')return {key:'na',label:'N/A',color:'grey'};if(!validDiscipline(r.risk)||!validDiscipline(r.strategy))return {key:'na',label:'N/A',color:'grey'};if(r.risk==='followed'&&r.strategy==='followed')return {key:'perfect',label:'Perfect Day',color:'green'};if(r.risk==='broke'&&r.strategy==='broke')return {key:'poor',label:'Poor Discipline',color:'red'};return {key:'mixed',label:'Mixed Day',color:'orange'}}
function resultLabel(v){return v==='win'?'Win':v==='loss'?'Loss':v==='break_even'?'Break Even':v==='no_trade'?'No Trade':'Unrecorded'}
function resultBadge(v){return `<span class="badge ${v||'unrecorded'}">${resultLabel(v)}</span>`}
function rowClass(v){return v==='win'?'row-win':v==='loss'?'row-loss':v==='break_even'?'row-break_even':v==='no_trade'?'row-no_trade':''}
function applicableDisciplineReviews(list){return list.filter(r=>r.result!=='no_trade'&&validDiscipline(r.risk)&&validDiscipline(r.strategy))}
function reviewsForRange(range=state.range){if(range==='all')return [...state.reviews];const days=Number(range),start=addDays(new Date(),-(days-1));start.setHours(0,0,0,0);return state.reviews.filter(r=>parseKey(r.date)>=start)}
function disciplinePct(field,reviews){const applicable=reviews.filter(r=>r.result!=='no_trade'&&validDiscipline(r[field]));if(!applicable.length)return null;return Math.round(applicable.filter(r=>r[field]==='followed').length/applicable.length*100)}
function perfectCount(reviews){return reviews.filter(r=>overall(r).key==='perfect').length}
function minMaxReviewDates(){if(!state.reviews.length)return null;const dates=state.reviews.map(r=>r.date).sort();return {min:dates[0],max:dates[dates.length-1]}}
function currentDisciplineStreak(){const mm=minMaxReviewDates();if(!mm)return 0;let cursor=parseKey(mm.max),n=0;while(cursor>=parseKey(mm.min)){const r=getReview(localDateKey(cursor));if(!r){if(isWeekendDate(cursor)){cursor=addDays(cursor,-1);continue}break}if(r.result==='no_trade'){cursor=addDays(cursor,-1);continue}if(overall(r).key!=='perfect')break;n++;cursor=addDays(cursor,-1)}return n}
function disciplineStreaks(){const mm=minMaxReviewDates();if(!mm)return[];let d=parseKey(mm.min),end=parseKey(mm.max),cur=0,out=[];while(d<=end){const r=getReview(localDateKey(d));if(!r){if(!isWeekendDate(d)&&cur){out.push(cur);cur=0}}else if(r.result==='no_trade'){}else if(overall(r).key==='perfect'){cur++}else{if(cur){out.push(cur);cur=0}}d=addDays(d,1)}if(cur)out.push(cur);return out}
function bestDisciplineStreak(){const s=disciplineStreaks();return s.length?Math.max(...s):0}
function previousDisciplineStreak(){const s=disciplineStreaks();const current=currentDisciplineStreak();if(!s.length)return null;if(current>0&&s[s.length-1]===current)return s.length>1?s[s.length-2]:null;return s[s.length-1]||null}
function previousBestDisciplineStreak(){const s=disciplineStreaks().sort((a,b)=>b-a);return s.length>1?s[1]:null}
function setupPerformanceStats(){const stats={setup_1:{trades:0,wins:0,losses:0},setup_2:{trades:0,wins:0,losses:0},setup_3:{trades:0,wins:0,losses:0},setup_4:{trades:0,wins:0,losses:0}};for(const r of state.reviews){if(!validSetup(r.setup))continue;if(r.result==='win'||r.result==='loss'||r.result==='break_even')stats[r.setup].trades++;if(r.result==='win')stats[r.setup].wins++;else if(r.result==='loss')stats[r.setup].losses++}for(const key of Object.keys(stats)){const s=stats[key],decided=s.wins+s.losses;s.winRate=decided?Math.round((s.wins/decided*100)*10)/10:null}return stats}
function formatSetupWinRate(v){return v==null?'Win Rate —':`Win Rate ${Number.isInteger(v)?v:v.toFixed(1)}%`}
function performance(){const trading=[...state.reviews].filter(r=>r.result==='win'||r.result==='loss').sort((a,b)=>b.date.localeCompare(a.date));const wins=trading.filter(r=>r.result==='win').length,losses=trading.length-wins,breakEvens=state.reviews.filter(r=>r.result==='break_even').length,winRate=trading.length?Math.round(wins/trading.length*100):0;let winStreak=0,lossStreak=0;if(trading[0]?.result==='win')for(const r of trading){if(r.result!=='win')break;winStreak++}if(trading[0]?.result==='loss')for(const r of trading){if(r.result!=='loss')break;lossStreak++}return {wins,losses,breakEvens,winRate,winStreak,lossStreak}}
function last30Summary(){let perfect=0,mixed=0,poor=0,none=0;for(let i=0;i<30;i++){const r=getReview(localDateKey(addDays(new Date(),-i))),o=overall(r);if(o.key==='perfect')perfect++;else if(o.key==='mixed')mixed++;else if(o.key==='poor')poor++;else none++}return {perfect,mixed,poor,none}}
function fmtDate(k,short=false){if(k===localDateKey())return 'Today';return new Intl.DateTimeFormat('en-GB',short?{day:'2-digit',month:'short'}:{weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(parseKey(k))}
function fmtStartDate(k){return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(parseKey(k))}
function dotStatus(v){if(v==='followed')return `<span class="status-cell"><i class="dot green"></i><span>Followed</span></span>`;if(v==='broke')return `<span class="status-cell"><i class="dot red"></i><span>Broke Rules</span></span>`;return `<span class="status-cell"><i class="dot grey"></i><span>N/A</span></span>`}
function overallHtml(r){const o=overall(r);return `<span class="overall ${o.color}"><i class="dot ${o.color}"></i>${o.label}</span>`}
function rangeLabel(){return state.range==='all'?'All Time':`${state.range} Days`}
function windowReviews(startDaysAgo,endDaysAgo){const start=addDays(new Date(),-startDaysAgo),end=addDays(new Date(),-endDaysAgo);start.setHours(0,0,0,0);end.setHours(23,59,59,999);return state.reviews.filter(r=>{const d=parseKey(r.date);return d>=start&&d<=end})}
function monthReviews(offset=0){const d=new Date(),y=d.getFullYear(),m=d.getMonth()+offset;const start=new Date(y,m,1),end=new Date(y,m+1,0);return state.reviews.filter(r=>{const x=parseKey(r.date);return x>=start&&x<=end})}
function setTrend(id,text,type='neutral'){const el=$(id);if(!el)return;el.textContent=text;el.className=`trend ${type}`}
function signed(n,suffix=''){return `${n>0?'+':''}${n}${suffix}`}
function renderComparisonText(){
 const cur=currentDisciplineStreak(),prev=previousDisciplineStreak();
 if(prev==null)setTrend('#streakTrend',cur?'New streak':'No previous data','neutral');else{const d=cur-prev;setTrend('#streakTrend',`${signed(d,' days')} from last streak`,d>0?'positive':d<0?'negative':'neutral')}
 const best=bestDisciplineStreak(),prevBest=previousBestDisciplineStreak();
 if(prevBest==null)setTrend('#bestStreakTrend',best?'New best':'No previous data','neutral');else{const d=best-prevBest;setTrend('#bestStreakTrend',`${signed(d,' days')} from previous best`,d>0?'positive':d<0?'negative':'neutral')}
 const c30=windowReviews(29,0),p30=windowReviews(59,30);
 for(const [field,id] of [['risk','#riskTrend'],['strategy','#strategyTrend']]){const c=disciplinePct(field,c30),p=disciplinePct(field,p30);if(c==null||p==null)setTrend(id,'No previous data','neutral');else{const d=c-p;setTrend(id,`${signed(d,'%')} vs previous 30 days`,d>0?'positive':d<0?'negative':'neutral')}}
 const cm=perfectCount(monthReviews(0)),pm=perfectCount(monthReviews(-1));if(!state.reviews.length||pm===0&&cm===0)setTrend('#perfectTrend','No previous data','neutral');else{const d=cm-pm;setTrend('#perfectTrend',`${signed(d)} from last month`,d>0?'positive':d<0?'negative':'neutral')}
}
function renderAll(){renderDashboard();renderHistory();renderReview();renderGoals();renderThemeButtons();renderSettings()}
function renderGoals(){
 const active=state.goals.filter(g=>g.status==='active'),done=state.goals.filter(g=>g.status==='completed').sort((a,b)=>String(b.completed_at||'').localeCompare(String(a.completed_at||'')));
 const activeList=$('#activeGoalsList'),doneList=$('#completedGoalsList'),activeEmpty=$('#activeGoalsEmpty'),doneEmpty=$('#completedGoalsEmpty');if(!activeList||!doneList)return;
 activeList.innerHTML=active.map(g=>`<div class="goal-row"><div class="goal-copy"><div class="goal-title">${esc(g.title)}</div><div class="goal-meta"><span>Added: ${fmtGoalDate(g.created_at)}</span></div></div><div class="goal-actions"><button class="goal-complete" data-goal-complete="${esc(g.id)}">Completed</button><button class="goal-delete" data-goal-delete="${esc(g.id)}" data-goal-status="active">Delete</button></div></div>`).join('');
 doneList.innerHTML=done.map(g=>`<div class="goal-row completed"><div class="goal-copy"><div class="goal-title"><span class="goal-check">✓</span>${esc(g.title)}</div><div class="goal-meta"><span>Added: ${fmtGoalDate(g.created_at)}</span><span>Completed: ${fmtGoalDate(g.completed_at)}</span></div></div><div class="goal-actions"><button class="goal-delete" data-goal-delete="${esc(g.id)}" data-goal-status="completed">Delete</button></div></div>`).join('');
 if(state.goalsError){activeEmpty.textContent='Goals database update required. Run the supplied Goals SQL update.';activeEmpty.style.display='block'}else{activeEmpty.textContent='No active goals yet.';activeEmpty.style.display=active.length?'none':'block'}
 doneEmpty.style.display=done.length?'none':'block';
}
function renderDashboard(){
 const filtered=reviewsForRange(),applicable=applicableDisciplineReviews(filtered),rp=disciplinePct('risk',filtered),sp=disciplinePct('strategy',filtered),cur=currentDisciplineStreak(),best=bestDisciplineStreak();
 $('#streakValue').textContent=`${cur} day${cur===1?'':'s'}`;$('#bestStreakValue').textContent=`${best} day${best===1?'':'s'}`;$('#riskPct').textContent=rp==null?'—':`${rp}%`;$('#strategyPct').textContent=sp==null?'—':`${sp}%`;$('#perfectDays').textContent=perfectCount(filtered);$('#riskNote').textContent=`${rangeLabel()} · ${applicable.length} applicable`;$('#strategyNote').textContent=`${rangeLabel()} · ${applicable.length} applicable`;$('#perfectNote').textContent=rangeLabel();$$('[data-range]').forEach(b=>b.classList.toggle('active',b.dataset.range===state.range));
 $('#officialStartValue').textContent=state.settings.officialStartDate?fmtStartDate(state.settings.officialStartDate):'Oct 22, 2026';$('#officialStartNote').textContent='Locked permanently';
 const p=performance();$('#winsValue').textContent=p.wins;$('#lossesValue').textContent=p.losses;$('#breakEvensValue').textContent=p.breakEvens;$('#winRateValue').textContent=`${p.winRate}%`;$('#winStreakValue').textContent=p.winStreak;$('#lossStreakValue').textContent=p.lossStreak;const ss=setupPerformanceStats();for(const [n,key] of [[1,'setup_1'],[2,'setup_2'],[3,'setup_3'],[4,'setup_4']]){const x=ss[key];$(`#setup${n}Trades`).textContent=`${x.trades} trade${x.trades===1?'':'s'}`;$(`#setup${n}WinRate`).textContent=formatSetupWinRate(x.winRate)}renderComparisonText();
 const today=new Date(),day=today.getDay(),monday=addDays(today,day===0?-6:1-day);$('#weekStrip').innerHTML=Array.from({length:7},(_,i)=>{const d=addDays(monday,i),o=overall(getReview(localDateKey(d)));return `<div class="day"><div class="day-name">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</div><div class="day-date">${new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short'}).format(d)}</div><i class="dot ${o.color}" title="${o.label}"></i></div>`}).join('');
 const s=last30Summary();$('#sPerfect').textContent=s.perfect;$('#sMixed').textContent=s.mixed;$('#sPoor').textContent=s.poor;$('#sNone').textContent=s.none;renderCalendar();const recent=[...state.reviews].slice(0,8);$('#dashboardHistory').innerHTML=recent.map(r=>`<tr class="${rowClass(r.result)}"><td>${fmtDate(r.date)}</td><td>${dotStatus(r.risk)}</td><td>${dotStatus(r.strategy)}</td><td>${resultBadge(r.result)}</td><td>${overallHtml(r)}</td></tr>`).join('');$('#dashboardEmpty').style.display=recent.length?'none':'block'
}
function renderCalendar(){const y=state.calendarMonth.getFullYear(),m=state.calendarMonth.getMonth();$('#calendarTitle').textContent=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric'}).format(state.calendarMonth);const first=new Date(y,m,1),offset=(first.getDay()+6)%7,start=addDays(first,-offset);let html=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<div class="cal-weekday">${x}</div>`).join('');for(let i=0;i<42;i++){const d=addDays(start,i),k=localDateKey(d),r=getReview(k),inMonth=d.getMonth()===m;let dots='';if(r){if(r.result==='no_trade')dots=`<i class="dot grey"></i><i class="dot grey"></i>`;else dots=`<i class="dot ${r.risk==='followed'?'green':r.risk==='broke'?'red':'grey'}"></i><i class="dot ${r.strategy==='followed'?'green':r.strategy==='broke'?'red':'grey'}"></i>`}html+=`<button class="cal-cell ${!inMonth?'muted ':''}${k===localDateKey()?'today ':''}${r?'clickable ':''}${r?.result?`result-${r.result}`:''}" data-cal-date="${k}"><span class="cal-daynum">${d.getDate()}</span><div><div class="cal-dots">${dots}</div>${r?`<div class="cal-result">${resultLabel(r.result)}</div>`:''}</div></button>`}$('#calendarGrid').innerHTML=html}
function filteredHistory(){return state.reviews.filter(r=>(state.filters.result==='all'||(state.filters.result==='unrecorded'?!r.result:r.result===state.filters.result))&&(state.filters.discipline==='all'||overall(r).key===state.filters.discipline))}
function renderHistory(){const list=filteredHistory();$('#historyBody').innerHTML=list.map(r=>`<tr class="${rowClass(r.result)}"><td>${fmtDate(r.date)}</td><td>${dotStatus(r.risk)}</td><td>${dotStatus(r.strategy)}</td><td>${setupShort(r.setup)}</td><td>${resultBadge(r.result)}</td><td>${overallHtml(r)}</td><td><div class="history-actions"><button class="icon-btn" data-action="view" data-date="${r.date}">View</button><button class="icon-btn" data-action="edit" data-date="${r.date}">Edit</button><button class="icon-btn delete" data-action="delete" data-date="${r.date}">Delete</button></div></td></tr>`).join('');$('#historyEmpty').style.display=list.length?'none':'block';$('#historyEmpty').textContent=state.reviews.length?'No records match this filter.':'No reviews found.'}
function reviewComplete(d){if(d.result==='no_trade')return true;if(!['win','loss','break_even'].includes(d.result))return false;if(!validDiscipline(d.strategy)||!validSetup(d.setup)||!Array.isArray(d.accountRisks)||!d.accountRisks.length)return false;return d.accountRisks.every(x=>{const a=accountById(x.account_id),ret=Number(x.trade_return_pct);if(!a?.account_size||![1,2].includes(Number(x.risk_pct))||!Number.isFinite(ret))return false;if(d.result==='win')return ret>0;if(d.result==='loss')return ret<0;return Math.abs(ret)<1e-9})}

function renderAccountSelector(){
 const wrap=$('#accountSelector');if(!wrap)return;const date=reviewDateKey(),isPast=date<localDateKey();const accounts=state.accounts.filter(a=>isPast||a.active!==false||state.draft.accountRisks.some(x=>x.account_id===a.id));if(!accounts.length){wrap.innerHTML='<div class="empty-mini">No active accounts. Add one in Settings.</div>';return}
 wrap.innerHTML=accounts.map(a=>{
  const sel=state.draft.accountRisks.find(x=>x.account_id===a.id),s=simulateAccount(a.id,date,date);
  const currentBalance=a.account_size?a.account_size*(1+s.totalReturn/100):null;
  const draftReturn=sel&&sel.trade_return_pct!==null&&sel.trade_return_pct!==''&&Number.isFinite(Number(sel.trade_return_pct))?Number(sel.trade_return_pct):null;
  const projectedTotal=s.totalReturn+(draftReturn??0);
  const projectedBalance=a.account_size?a.account_size*(1+projectedTotal/100):null;
  const projectedCycle=cycleNumberFromReturn(projectedTotal);
  const fmtBalance=v=>v==null?'':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v);
  const balanceText=fmtBalance(currentBalance),projectedText=fmtBalance(projectedBalance);
  const status=!a.account_size?'Set Account Size':`Balance ${balanceText} · ${cycleText(s.cycle)} · 2% ${s.status}${a.active===false?' · Archived':''}`;
  const preview=draftReturn===null?'':`<span data-balance-preview="${a.id}">After this trade: ${esc(projectedText)} · ${esc(cycleText(projectedCycle))} (${draftReturn>0?'+':''}${draftReturn}%)</span>`;
  return `<div class="account-pick ${sel?'selected':''} ${!a.account_size?'needs-size':''}"><button type="button" class="account-toggle" data-account-toggle="${a.id}" ${!a.account_size?'disabled':''}><strong>${esc(a.name)}</strong><span>${esc(status)}</span></button>${sel?`<div class="cycle-reminder"><strong>Before this trade</strong><span>${esc(balanceText)} · ${esc(cycleText(s.cycle))}</span>${preview}<span>2% Risk: ${s.status}</span><span>Discipline-safe risk today: ${s.safeRisk}</span></div><div class="risk-picks"><button type="button" class="risk-pick ${Number(sel.risk_pct)===1?'selected':''}" data-risk-account="${a.id}" data-risk="1">1%</button><button type="button" class="risk-pick ${Number(sel.risk_pct)===2?'selected':''}" data-risk-account="${a.id}" data-risk="2">2%</button></div><label class="return-field"><span>Trade Return %</span><input type="number" step="0.1" inputmode="decimal" data-return-account="${a.id}" value="${sel.trade_return_pct??''}" placeholder="${state.draft.result==='loss'?'-1':state.draft.result==='break_even'?'0':'+3'}" ${state.draft.result==='break_even'?'readonly':''}></label>`:''}</div>`
 }).join('')
}

function renderReview(){
 const date=reviewDateKey(),saved=getReview(date),today=date===localDateKey();
 const dateInput=$('#reviewDateInput');if(dateInput){dateInput.min=String(state.settings.officialStartDate||'2026-10-22');dateInput.max=localDateKey();dateInput.value=date}
 const isNoTrade=state.draft.result==='no_trade';
 if(isNoTrade){state.draft.risk=null;state.draft.strategy=null;state.draft.setup=null;state.draft.accountRisks=[]}
 if(state.draft.result==='break_even')state.draft.accountRisks.forEach(x=>x.trade_return_pct=0)
 const riskState=draftRiskStatus(state.draft,date);state.draft.risk=riskState.risk;
 $$('.choice[data-field]').forEach(b=>{b.classList.toggle('selected',state.draft[b.dataset.field]===b.dataset.value);if(b.dataset.field==='strategy'||b.dataset.field==='setup')b.disabled=isNoTrade});
 renderAccountSelector();
 const riskEl=$('#riskAutoStatus'),warn=$('#riskWarning');paintRiskStatus(riskState,riskEl,warn)
 const complete=reviewComplete(state.draft),dateLabel=today?'Today':fmtDate(date);$('#saveReviewBtn').disabled=!complete;$('#saveReviewBtn').textContent=saved?`Update ${dateLabel}`:`Save ${dateLabel}`;$('#reviewSummary strong').textContent=saved?`${dateLabel} already has a review`:`${dateLabel} review`;$('#reviewSummary span').textContent=isNoTrade?'No Trade selected — account risk, return, Risk, Strategy, and Setup are N/A.':saved?`Change any selection and update ${dateLabel.toLowerCase() === 'today' ? "today’s" : 'this'} review.`:'Choose account(s), risk %, Trade Return %, Strategy, Trading Setup, and Result.';const o=isNoTrade?{label:'N/A · No Trade',color:'grey'}:complete?overall(state.draft):{label:'Not complete',color:'grey'};$('#reviewOverall').className=`overall ${o.color}`;$('#reviewOverall').innerHTML=`<i class="dot ${o.color}"></i>${o.label}`
}

function renderSettings(){
 const box=$('#accountsList');if(!box)return;if(!state.accounts.length){box.innerHTML='<div class="empty-mini">No accounts yet.</div>';return}
 box.innerHTML=state.accounts.map(a=>{const s=simulateAccount(a.id,'9999-12-31');const size=a.account_size?new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(a.account_size):'Not set';return `<div class="account-setting ${a.active===false?'archived':''}"><div><strong>${esc(a.name)}</strong><small>Account Size: ${esc(size)} · ${a.account_size?cycleText(s.cycle):'Set size to start cycle tracking'} · ${a.active===false?'Archived':'Active'}</small></div><div class="backup-actions">${a.active!==false?`<button class="secondary small" data-account-edit="${a.id}">Edit</button><button class="secondary small" data-account-reset="${a.id}" ${!a.account_size?'disabled':''}>Reset Cycle</button><button class="secondary small" data-account-archive="${a.id}">Archive</button>`:`<button class="secondary small" data-account-unarchive="${a.id}">Unarchive</button>`}</div></div>`}).join('')
}

function renderThemeButtons(){const theme=document.documentElement.dataset.theme;$$('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===theme))}
function navigate(page){state.page=page;$$('.page').forEach(p=>p.classList.toggle('active',p.id===page));$$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));const c={dashboard:['Dashboard','Track discipline and outcome without confusing the two.'],review:['Daily Review','Accounts, risk %, Strategy, Trading Setup, then Result — completed in seconds.'],history:['History','Review, filter, edit, or remove previous days.'],goals:['Goals','Add personal targets and keep achieved goals as a dated history.'],training:['Trading System Training','Focused practice for your trading system and execution rules.'],settings:['Settings','Cloud sync, theme, and backup. Official Start Date is locked.']};$('#pageTitle').textContent=c[page][0];$('#pageSub').textContent=c[page][1];if(page==='review'){state.draft={risk:null,strategy:null,setup:null,result:null,accountRisks:[]};renderReview()}window.scrollTo({top:0,behavior:'smooth'})}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2300)}
function closeModal(){$('#modalBackdrop').classList.remove('show');state.pendingImport=null}
function showDay(date){const r=getReview(date);if(!r){$('#modal').innerHTML=`<h3>${fmtDate(date)}</h3><p>No review recorded for this day.</p><div class="modal-actions"><button class="secondary" id="modalClose">Close</button></div>`;$('#modalBackdrop').classList.add('show');$('#modalClose').onclick=closeModal;return}const rows=reviewAccountRisks(date);const reasons=[];for(const x of rows)reasons.push(...riskReasonsForSelection(x,date,r.result));$('#modal').innerHTML=`<h3>${fmtDate(date)}</h3><p>Discipline, setup, result, and account risk are shown separately.</p><div class="kv"><span>Accounts / Risk / Return</span><strong>${accountRiskSummary(r.date)}</strong></div>${reasons.length?`<div class="risk-warning">${[...new Set(reasons)].map(x=>`<div><strong>Reason:</strong> ${esc(x)}</div>`).join('')}</div>`:''}<div class="kv"><span>Risk Management</span>${dotStatus(r.risk)}</div><div class="kv"><span>Strategy</span>${dotStatus(r.strategy)}</div><div class="kv"><span>Trading Setup</span><strong>${setupLabel(r.setup)}</strong></div><div class="kv"><span>Daily Result</span>${resultBadge(r.result)}</div><div class="kv"><span>Overall Discipline</span>${overallHtml(r)}</div><div class="modal-actions"><button class="secondary" id="modalClose">Close</button><button class="primary" id="modalEdit">Edit</button></div>`;$('#modalBackdrop').classList.add('show');$('#modalClose').onclick=closeModal;$('#modalEdit').onclick=()=>showEdit(date)}

function showEdit(date){
 const r=getReview(date);if(!r)return;let draft={risk:r.risk,strategy:r.strategy,setup:r.setup||null,result:r.result,accountRisks:reviewAccountRisks(date).map(x=>({account_id:x.account_id,risk_pct:x.risk_pct,trade_return_pct:x.trade_return_pct}))};
 const draw=()=>{if(draft.result==='break_even')draft.accountRisks.forEach(x=>x.trade_return_pct=0);const accounts=state.accounts.filter(a=>a.active!==false||draft.accountRisks.some(x=>x.account_id===a.id)).map(a=>{const sel=draft.accountRisks.find(x=>x.account_id===a.id),st=simulateAccount(a.id,date,date),bal=a.account_size?a.account_size*(1+st.totalReturn/100):null,balText=bal==null?'Not set':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(bal);return `<div class="account-pick ${sel?'selected':''}"><button type="button" class="account-toggle" data-edit-account="${a.id}"><strong>${esc(a.name)}</strong><span>Balance ${esc(balText)} · ${cycleText(st.cycle)} · 2% ${st.status}</span></button>${sel?`<div class="risk-picks"><button type="button" class="risk-pick ${Number(sel.risk_pct)===1?'selected':''}" data-edit-risk-account="${a.id}" data-risk="1">1%</button><button type="button" class="risk-pick ${Number(sel.risk_pct)===2?'selected':''}" data-edit-risk-account="${a.id}" data-risk="2">2%</button></div><label class="return-field"><span>Trade Return %</span><input type="number" step="0.1" data-edit-return-account="${a.id}" value="${sel.trade_return_pct??''}" ${draft.result==='break_even'?'readonly':''}></label>`:''}</div>`}).join('');$('#modal').innerHTML=`<h3>Edit ${fmtDate(date)}</h3><div class="modal-form"><div><strong>Accounts</strong><div class="account-selector">${accounts}</div></div><div><strong>Risk Management</strong><div style="margin-top:8px">${dotStatus(draftRiskStatus(draft,date).risk)}</div></div><div><strong>Strategy</strong><div class="choices"><button class="choice followed ${draft.strategy==='followed'?'selected':''}" data-mf="strategy" data-v="followed">Followed</button><button class="choice broke ${draft.strategy==='broke'?'selected':''}" data-mf="strategy" data-v="broke">Broke Rules</button></div></div><div><strong>Trading Setup</strong><div class="choices setup-choices">${[1,2,3,4].map(n=>`<button class="choice setup-choice ${draft.setup===`setup_${n}`?'selected':''}" data-mf="setup" data-v="setup_${n}">Setup ${n}</button>`).join('')}</div></div><div><strong>Result</strong><div class="choices four">${[['win','Win'],['loss','Loss'],['break_even','Break Even'],['no_trade','No Trade']].map(([v,l])=>`<button class="choice ${v} ${draft.result===v?'selected':''}" data-mf="result" data-v="${v}">${l}</button>`).join('')}</div></div></div><div class="modal-actions"><button class="secondary" id="modalCancel">Cancel</button><button class="primary" id="modalSave">Save Changes</button></div>`;$('#modalBackdrop').classList.add('show');$$('[data-mf]',$('#modal')).forEach(b=>b.onclick=()=>{draft[b.dataset.mf]=b.dataset.v;if(draft.result==='no_trade'){draft.strategy=null;draft.setup=null;draft.accountRisks=[]}draw()});$$('[data-edit-account]',$('#modal')).forEach(b=>b.onclick=()=>{const id=b.dataset.editAccount,i=draft.accountRisks.findIndex(x=>x.account_id===id);if(i>=0)draft.accountRisks.splice(i,1);else draft.accountRisks.push({account_id:id,risk_pct:1,trade_return_pct:draft.result==='break_even'?0:null});draw()});$$('[data-edit-risk-account]',$('#modal')).forEach(b=>b.onclick=()=>{const row=draft.accountRisks.find(x=>x.account_id===b.dataset.editRiskAccount);if(row)row.risk_pct=Number(b.dataset.risk);draw()});$$('[data-edit-return-account]',$('#modal')).forEach(inp=>inp.oninput=()=>{const row=draft.accountRisks.find(x=>x.account_id===inp.dataset.editReturnAccount);if(row)row.trade_return_pct=inp.value===''?null:Number(inp.value)});$('#modalCancel').onclick=closeModal;$('#modalSave').onclick=async()=>{const v=validateDraft({date,...draft});if(!v.ok){toast(v.msg);return}$('#modalSave').disabled=true;try{await saveReview({date,...draft});closeModal();renderAll();toast('Review updated')}catch(e){toast(e.message||'Could not update review');$('#modalSave').disabled=false}}};draw()}

function confirmDelete(date){$('#modal').innerHTML=`<h3>Delete this daily review?</h3><p>${fmtDate(date)} will be removed from Dashboard and calculations. Your Start Date remains locked.</p><div class="modal-actions"><button class="secondary" id="deleteCancel">Cancel</button><button class="danger" id="deleteConfirm">Delete</button></div>`;$('#modalBackdrop').classList.add('show');$('#deleteCancel').onclick=closeModal;$('#deleteConfirm').onclick=async()=>{try{$('#deleteConfirm').disabled=true;await deleteReview(date);closeModal();renderAll();toast('Review deleted')}catch(e){toast(e.message||'Could not delete review');$('#deleteConfirm').disabled=false}}}
function exportBackup(){const payload={schema:BACKUP_SCHEMA,schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),reviews:state.reviews,accounts:state.accounts,accountRisks:state.accountRisks,accountResets:state.accountResets,preferences:{theme:state.settings.theme,officialStartDate:state.settings.officialStartDate,schemaVersion:SCHEMA_VERSION}};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`tradeflow-backup-${localDateKey()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup exported')}
function validateBackup(data){if(!data||typeof data!=='object'||!Array.isArray(data.reviews))return null;const reviews=normalizeReviews(data.reviews);if(data.reviews.length&&reviews.length===0)return null;const theme=['dark','light'].includes(data.preferences?.theme)?data.preferences.theme:null;const accounts=Array.isArray(data.accounts)?data.accounts:[];const accountRisks=Array.isArray(data.accountRisks)?data.accountRisks:[];const accountResets=Array.isArray(data.accountResets)?data.accountResets:[];return {reviews,theme,accounts,accountRisks,accountResets}}
function askImport(candidate){state.pendingImport=candidate;$('#modal').innerHTML=`<h3>Import backup?</h3><p>This will merge <strong>${candidate.reviews.length}</strong> review${candidate.reviews.length===1?'':'s'} into Supabase by date. Matching dates will be updated; other cloud reviews remain.</p><p>The locked Start Date stays <strong>Oct 22, 2026</strong>.</p><div class="modal-actions"><button class="secondary" id="importCancel">Cancel</button><button class="primary" id="importConfirm">Import Backup</button></div>`;$('#modalBackdrop').classList.add('show');$('#importCancel').onclick=closeModal;$('#importConfirm').onclick=async()=>{const c=state.pendingImport;try{$('#importConfirm').disabled=true;showLoading('Importing backup…');await api('import_backup',{reviews:c.reviews,theme:c.theme,accounts:c.accounts,accountRisks:c.accountRisks,accountResets:c.accountResets});closeModal();await bootstrap();navigate('dashboard');toast('Backup imported')}catch(e){toast(e.message||'Could not import backup')}finally{hideLoading()}}}
function handleImport(file){if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const c=validateBackup(JSON.parse(reader.result));if(!c){toast('Invalid backup file');return}askImport(c)}catch{toast('Invalid backup file')}};reader.onerror=()=>toast('Could not read backup file');reader.readAsText(file)}
function legacyLocalData(){try{const raw=JSON.parse(localStorage.getItem(LEGACY_REVIEWS_KEY)||'[]');const reviews=normalizeReviews(raw);const theme=localStorage.getItem(LEGACY_THEME_KEY);const prefs=JSON.parse(localStorage.getItem(LEGACY_PREFS_KEY)||'{}');return {reviews,theme:['dark','light'].includes(theme)?theme:null,officialStartDate:prefs.officialStartDate||prefs.startDate||null}}catch{return {reviews:[],theme:null,officialStartDate:null}}}
function confirmMigration(){const legacy=legacyLocalData();if(!legacy.reviews.length){toast('No legacy local data found');return}$('#modal').innerHTML=`<h3>Migrate local data?</h3><p>Found <strong>${legacy.reviews.length}</strong> older local review${legacy.reviews.length===1?'':'s'}. Supabase will merge by date, so 22 Oct 2026 will not duplicate.</p><div class="modal-actions"><button class="secondary" id="migCancel">Cancel</button><button class="primary" id="migConfirm">Migrate</button></div>`;$('#modalBackdrop').classList.add('show');$('#migCancel').onclick=closeModal;$('#migConfirm').onclick=async()=>{try{$('#migConfirm').disabled=true;showLoading('Migrating local data…');await api('migrate_local',{reviews:legacy.reviews,theme:legacy.theme});closeModal();await bootstrap();toast('Local data migrated')}catch(e){toast(e.message||'Could not migrate data')}finally{hideLoading()}}}

function openAddGoal(){
 if(state.goalsError){toast('Run the Goals SQL update first');return}
 $('#modal').innerHTML=`<h3>Add Goal</h3><p>Write the target you want to achieve.</p><input id="goalTitleInput" class="goal-input" maxlength="300" placeholder="e.g. Buy 100K FTMO Account" autocomplete="off"><div class="modal-actions"><button class="secondary" id="goalCancel">Cancel</button><button class="primary" id="goalSave">Add Goal</button></div>`;$('#modalBackdrop').classList.add('show');$('#goalCancel').onclick=closeModal;$('#goalSave').onclick=saveNewGoal;setTimeout(()=>$('#goalTitleInput')?.focus(),0)
}
async function refreshGoals(){state.goals=normalizeGoals(await api('list_goals'));state.goalsError='';renderGoals()}
async function saveNewGoal(){const title=$('#goalTitleInput')?.value.trim();if(!title){toast('Enter a goal');return}try{$('#goalSave').disabled=true;await api('add_goal',{title});closeModal();await refreshGoals();toast('Goal added')}catch(e){toast(e.message||'Could not add goal');if($('#goalSave'))$('#goalSave').disabled=false}}
async function completeGoal(id){try{setSync('Saving goal…','busy');await api('complete_goal',{id});await refreshGoals();setSync('Synced','ok');toast('Goal completed')}catch(e){setSync('Sync error','error');toast(e.message||'Could not complete goal')}}
async function deleteGoal(id,status){const msg=status==='completed'?'Delete this completed goal permanently?':'Delete this goal permanently?';if(!confirm(msg))return;try{setSync('Deleting goal…','busy');await api('delete_goal',{id});await refreshGoals();setSync('Synced','ok');toast('Goal deleted')}catch(e){setSync('Sync error','error');toast(e.message||'Could not delete goal')}}

// Events
$('#unlockForm').addEventListener('submit',e=>{e.preventDefault();unlockWithCode($('#accessCode').value.trim())})
$('#toggleCode').onclick=()=>{const input=$('#accessCode');input.type=input.type==='password'?'text':'password';$('#toggleCode').textContent=input.type==='password'?'Show':'Hide'}
$('#accessCode').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,4)})
$('#lockBtn').onclick=()=>{lockApp();toast('Session locked')}
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)))
$('#addGoalBtn').onclick=openAddGoal
$('#goals').addEventListener('click',e=>{const complete=e.target.closest('[data-goal-complete]'),del=e.target.closest('[data-goal-delete]');if(complete){completeGoal(complete.dataset.goalComplete);return}if(del)deleteGoal(del.dataset.goalDelete,del.dataset.goalStatus)})
$('#goReviewBtn').onclick=()=>navigate('review')
$$('.choice[data-field]').forEach(b=>b.addEventListener('click',()=>{state.draft[b.dataset.field]=b.dataset.value;if(b.dataset.field==='result'&&b.dataset.value==='no_trade'){state.draft.risk=null;state.draft.strategy=null;state.draft.setup=null;state.draft.accountRisks=[]}renderReview()}))
$('#clearReviewBtn').onclick=()=>{state.draft=blankDraft();renderReview()}
$('#saveReviewBtn').onclick=async()=>{const date=reviewDateKey();if(!reviewDateAllowed(date)){toast('Choose a date from the Official Start Date through today');return}if(!state.draft.result){toast('Choose a Result');return}if(!reviewComplete(state.draft)){toast('Choose account(s), risk %, Strategy, Trading Setup, and Result');return}const existed=!!getReview(date);$('#saveReviewBtn').disabled=true;showLoading(existed?'Updating review…':'Saving review…');try{await saveReview({date,...state.draft});loadDraftForDate(date);renderAll();toast(existed?'Review updated':'Review saved');navigate('review')}catch(e){toast(e.message||'Could not save review')}finally{hideLoading();renderReview()}}
$('#historyBody').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;if(b.dataset.action==='view')showDay(b.dataset.date);if(b.dataset.action==='edit')showEdit(b.dataset.date);if(b.dataset.action==='delete')confirmDelete(b.dataset.date)})
$('#calendarGrid').addEventListener('click',e=>{const cell=e.target.closest('[data-cal-date]');if(cell)showDay(cell.dataset.calDate)})
$('#modalBackdrop').addEventListener('click',e=>{if(e.target===$('#modalBackdrop'))closeModal()})
$$('[data-theme-choice]').forEach(b=>b.onclick=()=>applyTheme(b.dataset.themeChoice,true))
$$('[data-range]').forEach(b=>b.onclick=()=>{state.range=b.dataset.range;renderDashboard()})
$('#prevMonth').onclick=()=>{state.calendarMonth=new Date(state.calendarMonth.getFullYear(),state.calendarMonth.getMonth()-1,1);renderCalendar()}
$('#nextMonth').onclick=()=>{state.calendarMonth=new Date(state.calendarMonth.getFullYear(),state.calendarMonth.getMonth()+1,1);renderCalendar()}
$('#resultFilter').onchange=e=>{state.filters.result=e.target.value;renderHistory()}
$('#disciplineFilter').onchange=e=>{state.filters.discipline=e.target.value;renderHistory()}
$('#accountSelector').addEventListener('click',e=>{const t=e.target.closest('[data-account-toggle]'),rp=e.target.closest('[data-risk-account]');if(t){const id=t.dataset.accountToggle,i=state.draft.accountRisks.findIndex(x=>x.account_id===id);if(i>=0)state.draft.accountRisks.splice(i,1);else state.draft.accountRisks.push({account_id:id,risk_pct:1,trade_return_pct:state.draft.result==='break_even'?0:null});renderReview();return}if(rp){const row=state.draft.accountRisks.find(x=>x.account_id===rp.dataset.riskAccount);if(row)row.risk_pct=Number(rp.dataset.risk);renderReview()}})
$('#accountSelector').addEventListener('input',e=>{const inp=e.target.closest('[data-return-account]');if(!inp)return;const id=inp.dataset.returnAccount,row=state.draft.accountRisks.find(x=>x.account_id===id);if(row)row.trade_return_pct=inp.value===''?null:Number(inp.value);const date=reviewDateKey(),a=accountById(id),s=simulateAccount(id,date,date),ret=row&&row.trade_return_pct!==null&&Number.isFinite(Number(row.trade_return_pct))?Number(row.trade_return_pct):null,preview=document.querySelector(`[data-balance-preview="${id}"]`);if(a?.account_size){const projectedTotal=s.totalReturn+(ret??0),projected=a.account_size*(1+projectedTotal/100),afterCycle=cycleNumberFromReturn(projectedTotal),txt=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(projected);if(preview){preview.textContent=ret===null?'':`After this trade: ${txt} · ${cycleText(afterCycle)} (${ret>0?'+':''}${ret}%)`}else if(ret!==null){const reminder=inp.closest('.account-pick')?.querySelector('.cycle-reminder');if(reminder){const span=document.createElement('span');span.dataset.balancePreview=id;span.textContent=`After this trade: ${txt} · ${cycleText(afterCycle)} (${ret>0?'+':''}${ret}%)`;const riskSpan=[...reminder.querySelectorAll('span')].find(x=>x.textContent.startsWith('2% Risk:'));reminder.insertBefore(span,riskSpan||null)}}}const riskState=draftRiskStatus(state.draft,reviewDateKey());state.draft.risk=riskState.risk;paintRiskStatus(riskState,$('#riskAutoStatus'),$('#riskWarning'));const complete=reviewComplete(state.draft);$('#saveReviewBtn').disabled=!complete;const o=state.draft.result==='no_trade'?{label:'N/A · No Trade',color:'grey'}:complete?overall(state.draft):{label:'Not complete',color:'grey'};$('#reviewOverall').className=`overall ${o.color}`;$('#reviewOverall').innerHTML=`<i class="dot ${o.color}"></i>${o.label}`})
$('#accountSelector').addEventListener('change',e=>{const inp=e.target.closest('[data-return-account]');if(!inp)return;const row=state.draft.accountRisks.find(x=>x.account_id===inp.dataset.returnAccount);if(row)row.trade_return_pct=inp.value===''?null:Number(inp.value);const riskState=draftRiskStatus(state.draft,reviewDateKey());state.draft.risk=riskState.risk;paintRiskStatus(riskState,$('#riskAutoStatus'),$('#riskWarning'));$('#saveReviewBtn').disabled=!reviewComplete(state.draft)})
const reviewDateInput=$('#reviewDateInput');if(reviewDateInput)reviewDateInput.addEventListener('change',e=>{const date=e.target.value;if(!reviewDateAllowed(date)){toast('Choose a date from the Official Start Date through today');e.target.value=reviewDateKey();return}loadDraftForDate(date);renderReview()})
$('#addAccountBtn').onclick=async()=>{const name=$('#newAccountName').value.trim(),size=Number($('#newAccountSize').value);if(!name){toast('Enter an account name');return}if(!Number.isFinite(size)||size<=0){toast('Enter a valid Account Size');return}try{await api('add_account',{name,accountSize:size});$('#newAccountName').value='';$('#newAccountSize').value='';await bootstrap();toast('Account added · Cycle 3 Caution')}catch(e){toast(e.message||'Could not add account')}}
$('#accountsList').addEventListener('click',async e=>{const edit=e.target.closest('[data-account-edit]'),reset=e.target.closest('[data-account-reset]'),arc=e.target.closest('[data-account-archive]'),unarc=e.target.closest('[data-account-unarchive]');if(edit){const a=accountById(edit.dataset.accountEdit),name=prompt('Account name',a?.name||'');if(!name?.trim())return;const size=Number(prompt('Account Size',a?.account_size||''));if(!Number.isFinite(size)||size<=0){toast('Enter a valid Account Size');return}try{await api('update_account',{id:a.id,name:name.trim(),accountSize:size});await bootstrap();toast('Account updated')}catch(err){toast(err.message||'Could not update account')}}if(reset){const a=accountById(reset.dataset.accountReset);if(!confirm(`Reset ${a?.name||'this account'} to Cycle 3 · Caution? History will remain.`))return;try{await api('reset_account',{id:a.id});await bootstrap();toast('Cycle reset · Cycle 3 Caution')}catch(err){toast(err.message||'Could not reset cycle')}}if(arc){const a=accountById(arc.dataset.accountArchive);if(!confirm(`Archive ${a?.name||'this account'}? Historical reviews will remain.`))return;try{await api('archive_account',{id:a.id});await bootstrap();toast('Account archived')}catch(err){toast(err.message||'Could not archive account')}}if(unarc){const a=accountById(unarc.dataset.accountUnarchive);if(!confirm(`Restore ${a?.name||'this account'} to Active Accounts?`))return;try{await api('unarchive_account',{id:a.id});await bootstrap();toast('Account unarchived')}catch(err){toast(err.message||'Could not unarchive account')}}})

$('#exportBackupBtn').onclick=exportBackup
$('#importBackupBtn').onclick=()=>$('#importFile').click()
$('#importFile').onchange=e=>{handleImport(e.target.files?.[0]);e.target.value=''}
$('#migrateLocalBtn').onclick=confirmMigration

// Initial visual state
const cachedTheme=(()=>{try{return localStorage.getItem(THEME_CACHE_KEY)||localStorage.getItem(LEGACY_THEME_KEY)||'dark'}catch{return'dark'}})()
applyThemeLocal(['dark','light'].includes(cachedTheme)?cachedTheme:'dark')
$('#todayLabel').textContent=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date())
$('.app').classList.add('is-locked'); $('.mobile-nav').classList.add('is-locked')
if(!configReady()) $('#authError').textContent='TradeFlow configuration is incomplete.'
else if(sessionToken()) { unlockUi(); bootstrap() }

window.TradeFlowTest={state,overall,performance,currentDisciplineStreak,bestDisciplineStreak,disciplinePct,renderAll,normalizeReviews}
})()
