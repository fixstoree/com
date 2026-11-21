/* FIX STORE V5.3 — SPA views. All shop data remains in Firestore.
 * Firebase Auth alone persists its session in IndexedDB (not localStorage).
 * If IndexedDB is blocked (e.g. file:// opaque origins), Firebase falls back to memory.
 * Admin claims and Firestore rules — never client-side role alone — control admin writes.
 */
(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const app=$('#app'),LEGACY_CATS={game:'โค้ดเกม',account:'รหัสเกม',wallet:'บัตรเติมเงิน',subscription:'สมาชิกพรีเมียม'},ST={pending:'รอตรวจสอบ',processing:'กำลังดำเนินการ',completed:'สำเร็จ',cancelled:'ยกเลิก'};
let announcementUnsubscribe=null, catalogUnsubscribes=[],announcementMarkup='';
const DELIVERY_MODES={instant:'ซื้อแล้วรับทันที',random:'ซื้อแล้วสุ่มรับ',manual:'รอแอดมินยืนยัน',netflix:'รับข้อมูล Netflix ทันที'};
let claimUnsubscribe=null,orderUnsubscribe=null,adminOrderUnsubscribe=null,claimSound=null,claimsLoaded=false;
let walletBalanceUnsubscribe=null,walletLedgerUnsubscribe=null,cartUnsubscribe=null,pendingLiveUpdate=null;
let catalogServerConfirmed=false;
const cartAutoRemovalPending=new Set();
let userFinancePanel={uid:null,items:[],nextCursor:null,hasMore:false,loading:false,error:null,balanceSatang:null};
// Admin finance streaming uses a Firebase-authenticated Backend SSE connection.
// No full-page rerender or recurring polling. Listeners stop on close, tab change or logout.
let financeLiveAbort=null,financeLiveUid=null,financeLiveRetry=null,financeLiveRefresh=null;
function stopFinanceLive(){
 if(financeLiveRetry!==null){clearTimeout(financeLiveRetry);financeLiveRetry=null}
 if(financeLiveRefresh!==null){clearTimeout(financeLiveRefresh);financeLiveRefresh=null}
 if(financeLiveAbort){financeLiveAbort.abort();financeLiveAbort=null}
 financeLiveUid=null;
}
function financeTabVisible(uid){return state.admin&&state.user&&financeLiveUid===uid&&$('#editor-modal [data-user-manager-uid="'+uid+'"]')&&$('#user-finance-pane:not([hidden])')}
async function connectFinanceLive(uid){
 if(!financeTabVisible(uid))return;
 const controller=new AbortController();financeLiveAbort=controller;
 try{
  const token=await state.A.getIdToken(state.auth.currentUser);
  if(controller.signal.aborted||!financeTabVisible(uid))return;
  const resp=await fetch(walletApiBase()+'/api/admin/users/'+encodeURIComponent(uid)+'/finance/stream',{headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'},cache:'no-store',signal:controller.signal});
  if(!resp.ok||!resp.body)throw Error('Realtime API ตอบกลับ '+resp.status);
  const reader=resp.body.getReader(),decoder=new TextDecoder();let buffer='';
  while(financeTabVisible(uid)&&!controller.signal.aborted){
   const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
   // Consume discrete SSE messages. Server sends a signal, never user data.
   let split;while((split=buffer.indexOf('\n\n'))!==-1){
    const event=buffer.slice(0,split);buffer=buffer.slice(split+2);
    if(!event.split('\n').some(line=>line.trim()==='event: changed'))continue;
    if(financeLiveRefresh!==null)clearTimeout(financeLiveRefresh);
    financeLiveRefresh=setTimeout(()=>{financeLiveRefresh=null;if(financeTabVisible(uid))void loadUserFinancialHistory(uid,false)},180);
   }
   if(buffer.length>65536)buffer='';
  }
 }catch(e){if(!controller.signal.aborted)console.warn('[FIX STORE] admin finance stream:',e.message)}
 finally{
  if(financeLiveAbort===controller)financeLiveAbort=null;
  if(!controller.signal.aborted&&financeTabVisible(uid))financeLiveRetry=setTimeout(()=>{financeLiveRetry=null;void connectFinanceLive(uid)},4500);
 }
}
function startFinanceLive(uid){
 if(!uid||!state.admin)return;
 if(financeLiveUid===uid&&(financeLiveAbort||financeLiveRetry!==null))return;
 stopFinanceLive();financeLiveUid=uid;void connectFinanceLive(uid);
}

const liveSignatures={products:'',categories:'',orders:'',adminOrders:'',claims:'',walletBalance:'',walletLedger:'',cart:''};
const state={ready:false,loading:true,error:null,F:null,A:null,auth:null,db:null,user:null,admin:false,products:[],categories:[],announcements:[],announcementError:null,categoryError:null,productError:null,cart:[],orders:[],settings:{storeName:'FIX STORE',announcement:'',supportLink:'',discordUrl:'',youtubeUrl:'',lineUrl:''},current:'home',filter:'all',stockFilter:'all',search:'',sort:'featured',busy:false,editorId:null,stockProduct:'',stock:[],members:[],claims:[],adminOrders:[],adminClaimTab:'pending',soundEnabled:false,walletSatang:0,walletHistory:[],walletIntent:null,walletAmount:100,walletLoading:false,walletError:null,walletConfig:null,walletLoaded:false,walletMethod:'qr',adminUsers:[],adminUsersError:null,adminUsersLoading:false,adminUsersPartial:false,apiMonitor:null,apiMonitorError:null,apiMonitorLoading:false,discountDrawer:false,discountCode:'',discountPreview:null,codeHistories:{topup:{items:[],nextCursor:null,hasMore:false,loading:false,error:null},discount:{items:[],nextCursor:null,hasMore:false,loading:false,error:null}}};
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=x=>'฿'+(Number(x)||0).toLocaleString('th-TH',{maximumFractionDigits:2});
const num=x=>Number.isFinite(Number(x))?Number(x):0;
const percentText=n=>num(n).toLocaleString('th-TH',{maximumFractionDigits:0})+'%';
function discountSummary(){const p=state.discountPreview;return p&&p.valid?{discountSatang:num(p.discountSatang),finalSatang:num(p.finalSatang),subtotalSatang:num(p.subtotalSatang)}:{discountSatang:0,finalSatang:0,subtotalSatang:0}}
const alias=name=>name.toLowerCase()+'@users.fixstore.invalid'; // compatibility with previous FIX STORE versions
const goodUser=name=>/^[a-z0-9_]{4,20}$/.test(name);
const https=s=>{try{const u=new URL(String(s));return u.protocol==='https:'?u.href:''}catch{return ''}};
const doc=(...path)=>state.F.doc(state.db,...path),col=(...path)=>state.F.collection(state.db,...path);
const now=()=>state.F.serverTimestamp();
const link=(page,query='')=>'#/'+page+(query?'?'+query:'');
// Login gate shared by wallet, account and admin routes.
function guard(title='กรุณาเข้าสู่ระบบ',detail='เข้าสู่ระบบก่อนทำรายการ',next='login'){
 return `<section class="page-in glass" style="max-width:560px;margin:42px auto;padding:28px;border-radius:18px;text-align:center"><span class="eyebrow">FIX STORE / MEMBER ACCESS</span><h1 style="font-size:24px;margin:12px 0">${safe(title)}</h1><p class="muted" style="line-height:1.7">${safe(detail)}</p><a class="btn btn-primary" href="${link(next)}" style="display:inline-flex;margin-top:14px">เข้าสู่ระบบ ${ico('arrow')}</a></section>`;
}

const ico=(name)=>{const paths={arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',bag:'<path d="M4 8h16l-1 12H5L4 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',check:'<path d="m4 12 5 5L20 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',edit:'<path d="M4 20l4-.8L20 7l-4-4L5 16l-1 4Z"/>',box:'<path d="m3 7 9 5 9-5-9-5-9 5ZM3 7v10l9 5 9-5V7M12 12v10"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M2 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 4 5"/>',logout:'<path d="M10 17l5-5-5-5m5 5H3"/><path d="M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="m19.4 15 1.5 1.2-2 3.5-1.9-.5a8 8 0 0 1-2.1 1.2l-.5 2h-4l-.5-2a8 8 0 0 1-2.1-1.2l-1.9.5-2-3.5L5.4 15a8 8 0 0 1 0-2.4l-1.5-1.2 2-3.5 1.9.5a8 8 0 0 1 2.1-1.2l.5-2h4l.5 2a8 8 0 0 1 2.1 1.2l1.9-.5 2 3.5-1.5 1.2a8 8 0 0 1 0 2.4Z"/>',eye:'<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',ticket:'<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z"/><path d="M12 6v12" stroke-dasharray="2 2"/>'};return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.check}</svg>`};
const noticeUrl=value=>{const s=String(value||'').trim();if(/^#\/(?:home|shop|help|cart|orders|account|login|register)(?:\?.*)?$/.test(s))return s;return https(s)};
const activeNotices=()=>state.announcements.filter(n=>n.active===true&&String(n.text||'').trim()).sort((a,b)=>num(a.order)-num(b.order));
function renderAnnouncements(){syncHomeTicker();const bar=$('#announcement-bar'),track=$('#announcement-track');if(!bar||!track)return;let list=activeNotices();if(!state.announcements.length&&state.settings.announcement){list=[{id:'legacy',text:state.settings.announcement,href:'',active:true,order:0}]}if(!list.length){bar.hidden=true;if(announcementMarkup){track.replaceChildren();announcementMarkup=''}return}bar.hidden=false;const item=n=>{const href=noticeUrl(n.href);const content=`<span class="announcement-bullet" aria-hidden="true">✦</span><span>${safe(String(n.text||'').slice(0,180))}</span>`;return href?`<a class="announcement-item" href="${safe(href)}" ${href.startsWith('https:')?'target="_blank" rel="noopener noreferrer"':''}>${content}<span aria-hidden="true">↗</span></a>`:`<span class="announcement-item">${content}</span>`};const group=list.map(item).join('');const nextMarkup=JSON.stringify([group,list.length>1]);if(announcementMarkup===nextMarkup){bar.hidden=false;return}announcementMarkup=nextMarkup;track.innerHTML=`<div class="announcement-set">${group}</div>${list.length>1?`<div class="announcement-set" aria-hidden="true" inert>${group}</div>`:''}`;track.classList.toggle('animate',list.length>1)}
function renderFooter(){/* Footer links are internal SPA routes and require no runtime rewriting. */}
const errMsg=e=>({'auth/invalid-credential':'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง','auth/invalid-login-credentials':'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง','auth/wrong-password':'รหัสผ่านไม่ถูกต้อง','auth/user-not-found':'ไม่พบชื่อผู้ใช้นี้','auth/email-already-in-use':'ชื่อผู้ใช้นี้ถูกสมัครแล้ว','auth/invalid-email':'ระบบไม่ยอมรับชื่อผู้ใช้ที่แปลงเป็นอีเมล กรุณาแจ้งผู้ดูแล','auth/weak-password':'รหัสผ่านสั้นเกินไป','auth/operation-not-allowed':'ยังไม่ได้เปิด Email/Password ใน Firebase Authentication','auth/unauthorized-domain':'โดเมนไม่ได้รับอนุญาตใน Firebase Authentication','auth/network-request-failed':'เชื่อมต่อ Firebase ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต','auth/too-many-requests':'มีการลองหลายครั้ง กรุณาลองใหม่ในภายหลัง','permission-denied':'Firestore Rules ไม่อนุญาตให้ทำรายการนี้','unavailable':'Firebase ไม่พร้อมใช้งานชั่วคราว'}[e?.code]||e?.message||'เกิดข้อผิดพลาด');
/* Unified FIX STORE notifications and native-dialog replacement.
   Keep state in memory and never claim a transaction succeeded before its API responds. */
function toast(message,type='ok'){
 const host=$('#toast-area');if(!host)return;
 const tone=type==='error'?'error':type==='warning'?'warning':type==='info'?'info':'ok';
 const el=document.createElement('section');el.className='fx-toast '+tone;
 el.setAttribute('role',tone==='error'?'alert':'status');
 const icon=document.createElement('span');icon.className='fx-toast-icon';icon.setAttribute('aria-hidden','true');
 icon.innerHTML=tone==='error'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></svg>':tone==='warning'?ico('clock'):tone==='info'?ico('box'):ico('check');
 const content=document.createElement('span');content.className='fx-toast-content';
 const title=document.createElement('strong');title.textContent={ok:'ทำรายการสำเร็จ',error:'เกิดข้อผิดพลาด',warning:'โปรดตรวจสอบ',info:'แจ้งเตือนจาก FIX STORE'}[tone];
 const detail=document.createElement('span');detail.className='fx-toast-message';detail.textContent=String(message??'');content.append(title,detail);
 const close=document.createElement('button');close.type='button';close.className='fx-toast-close';close.textContent='×';close.setAttribute('aria-label','ปิดแจ้งเตือน');
 close.addEventListener('click',()=>el.remove());
 const progress=document.createElement('span');progress.className='fx-toast-progress';progress.setAttribute('aria-hidden','true');
 el.append(icon,content,close,progress);host.append(el);
 while(host.children.length>4)host.firstElementChild?.remove();
 setTimeout(()=>{if(!el.isConnected)return;el.classList.add('leaving');setTimeout(()=>el.remove(),240)},5350);
}
let activeConfirm=null;
// Admin-only confirmation UI: storefront customer actions do not show confirm popups.
function askConfirm(message,{title='ยืนยันการทำรายการ',confirmLabel='ยืนยัน',danger=false,detail=''}={}){
 if(!state.admin || !route().path.startsWith('admin'))return Promise.resolve(false);
 if(activeConfirm)return Promise.resolve(false);
 return new Promise(resolve=>{
  const backdrop=document.createElement('div');backdrop.className='fx-confirm-backdrop';backdrop.id='fx-confirm-overlay';
  const panel=document.createElement('section');panel.className='fx-confirm-panel';panel.setAttribute('role','alertdialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','fx-confirm-title');panel.setAttribute('aria-describedby','fx-confirm-message');
  panel.innerHTML=`<div class="fx-confirm-top"><span class="fx-confirm-mark ${danger?'danger':'normal'}" aria-hidden="true">${danger?'!':'✓'}</span><div><small>FIX STORE / CONFIRM ACTION</small><h2 id="fx-confirm-title"></h2></div></div><p class="fx-confirm-message" id="fx-confirm-message"></p>${detail?'<div class="fx-confirm-footnote"></div>':''}<div class="fx-confirm-actions"><button class="fx-confirm-cancel" type="button" data-confirm-result="cancel">ยกเลิก</button><button class="fx-confirm-approve ${danger?'danger':''}" type="button" data-confirm-result="approve"></button></div>`;
  panel.querySelector('#fx-confirm-title').textContent=title;
  panel.querySelector('#fx-confirm-message').textContent=String(message||'');
  if(detail)panel.querySelector('.fx-confirm-footnote').textContent=detail;
  panel.querySelector('[data-confirm-result="approve"]').textContent=confirmLabel;
  backdrop.append(panel);
  const previous=document.activeElement;
  const finish=(confirmed)=>{
   if(activeConfirm!==backdrop)return;
   activeConfirm=null;backdrop.remove();document.removeEventListener('keydown',onKey,true);
   if(previous&&previous.isConnected&&typeof previous.focus==='function')previous.focus({preventScroll:true});
   resolve(confirmed);
  };
  const onKey=e=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);return;}
   if(e.key==='Tab'){
    const buttons=[...panel.querySelectorAll('button:not(:disabled)')];
    if(!buttons.length)return;
    const first=buttons[0],last=buttons[buttons.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  };
  backdrop.addEventListener('click',e=>{
   const choice=e.target.closest?.('[data-confirm-result]');
   if(choice){finish(choice.dataset.confirmResult==='approve');return;}
   if(e.target===backdrop)finish(false);
  });
  activeConfirm=backdrop;document.body.append(backdrop);document.addEventListener('keydown',onKey,true);
  panel.querySelector('[data-confirm-result="cancel"]').focus({preventScroll:true});
 });
}
const route=()=>{const raw=location.hash.replace(/^#\/?/,'')||'home';const [path,params='']=raw.split('?');return {path:path||'home',params:new URLSearchParams(params)};};
function go(to){const next=link(to);if(location.hash===next)render();else location.hash=next}
function busyButton(btn,active,text='กำลังดำเนินการ...'){if(!btn)return;if(active){btn.dataset.original=btn.innerHTML;btn.disabled=true;btn.textContent=text}else{btn.disabled=false;btn.innerHTML=btn.dataset.original||btn.innerHTML}}
function setStatus(){const c=$('#connection'),txt=$('#connection-text');c.classList.toggle('ready',state.ready);c.classList.toggle('error',!!state.error);txt.textContent=state.ready?'FIREBASE READY':state.error?'OFFLINE':'CONNECTING';let n=state.cart.reduce((s,c)=>s+num(c.quantity),0);const b=$('#cart-badge');b.hidden=n===0;b.textContent=n>99?'99+':String(n);
const credit=$('#header-credit'),creditAmount=$('#header-credit-amount');if(credit&&creditAmount){credit.hidden=!state.user;const ready=!!state.walletLoaded;creditAmount.textContent=ready?'฿'+(num(state.walletSatang)/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}):'฿—';credit.title=ready?'เครดิตคงเหลือ':'ยอดเครดิตยังโหลดไม่สำเร็จ กรุณาตรวจสอบ Backend';}$('#account-label').textContent=state.user?state.user.username:'เข้าสู่ระบบ';$('#account-link').href=link(state.user?'account':'login');const mobileAccount=$('#mobile-account-link');if(mobileAccount)mobileAccount.href=link(state.user?'account':'login');const register=$('#register-shortcut');if(register)register.hidden=!!state.user;syncMobileAccountMenu()}
// Shared user dropdown mirrors the authenticated account without exposing private values in HTML.
function syncMobileAccountMenu(){
 const nav=$('#mobile-nav');if(!nav)return;
 const loggedIn=!!state.user;
 const username=loggedIn?String(state.user.username||'member'):'FIX STORE';
 const name=$('#fx-mobile-menu-name'),handle=$('#fx-mobile-menu-handle');
 const role=$('#fx-mobile-menu-role'),balance=$('#fx-mobile-menu-balance'),credit=$('#fx-mobile-menu-credit');
 if(name)name.textContent=loggedIn?username:'ยินดีต้อนรับ';
 if(handle)handle.textContent=loggedIn?'@'+username:'เข้าสู่ระบบเพื่อใช้งานบัญชี';
 if(role)role.textContent=state.admin&&loggedIn?'ADMIN':loggedIn?'MEMBER':'GUEST';
 if(balance)balance.hidden=!loggedIn;
 if(credit)credit.textContent=state.walletLoaded?'฿'+(num(state.walletSatang)/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}):'฿—';
 nav.querySelectorAll('[data-menu-auth]').forEach(el=>{
  const requirement=el.dataset.menuAuth;
  el.hidden=requirement==='signed-in'?!loggedIn:requirement==='signed-out'?loggedIn:!(loggedIn&&state.admin);
 });
}
function closeMobileAccountMenu({restoreFocus=false}={}){
 const menu=$('#mobile-nav'),toggle=$('#mobile-menu-toggle');
 if(!menu||!toggle)return;
 const open=!menu.hidden;
 menu.hidden=true;
 toggle.setAttribute('aria-expanded','false');
 toggle.setAttribute('aria-label','เปิดเมนูเพิ่มเติม');
 if(restoreFocus&&open)toggle.focus({preventScroll:true});
}
function subscribeAnnouncements(){if(!state.ready||typeof state.F.onSnapshot!=='function'||announcementUnsubscribe)return;announcementUnsubscribe=state.F.onSnapshot(col('announcements'),snap=>{if(snap.docChanges().length===0)return;state.announcements=snap.docs.map(d=>({id:d.id,...d.data()}));state.announcementError=null;renderAnnouncements();if(state.current==='admin-announcements'&&!$('#editor-modal'))scheduleLiveUpdate()},err=>{state.announcementError=err;console.warn('[FIX STORE] realtime announcements:',err)})}
async function loadAnnouncements(){if(!state.ready)return;try{const snap=await state.F.getDocs(col('announcements'));state.announcements=snap.docs.map(d=>({id:d.id,...d.data()}));state.announcementError=null;renderAnnouncements()}catch(e){state.announcementError=e;console.warn('[FIX STORE] announcements:',e);if(state.admin)toast('โหลดประกาศไม่ได้: '+errMsg(e),'error')}}
async function loadCategories(){if(!state.ready)return;try{const snap=await state.F.getDocs(col('categories'));state.categories=snap.docs.map(d=>({id:d.id,...d.data()}));state.categoryError=null}catch(e){state.categoryError=e;console.error('loadCategories',e);toast('โหลดหมวดหมู่ไม่ได้: '+errMsg(e),'error')}}
async function loadProducts(){if(!state.ready)return;try{const snap=await state.F.getDocs(col('products'));state.products=snap.docs.map(d=>({id:d.id,...d.data()}));state.productError=null}catch(e){state.productError=e;toast('โหลดสินค้าไม่ได้: '+errMsg(e),'error')}}
/* Firestore subscriptions update changed regions only, and coalesce bursts.
   There is no render loop, interval, or per-frame listener here. */
function liveSignature(snap){return snap.docs.map(d=>d.id+':'+JSON.stringify(d.data())).join('||')}
function replaceLivePart(actualRoot,newRoot,selector){
 const old=actualRoot.querySelector(selector),fresh=newRoot.querySelector(selector);
 if(!old||!fresh||old.outerHTML===fresh.outerHTML)return;
 // Avoid erasing values while customers/admins are typing.
 if(old.contains(document.activeElement)&&document.activeElement?.matches?.('input,textarea,select,[contenteditable]'))return;
 old.replaceWith(fresh);
}
function scheduleLiveUpdate(){
 if(pendingLiveUpdate!==null)return;
 pendingLiveUpdate=setTimeout(()=>{pendingLiveUpdate=null;patchVisibleRealtime()},65);
}
function patchVisibleRealtime(){
 const path=route().path;
 if(!state.ready||state.current!==path||$('#editor-modal')||$('#wallet-modal')||$('#fx-confirm-overlay'))return;
 const renderers={home:renderHome,shop:renderShop,product:renderProduct,orders:renderOrders,account:renderAccount,admin:renderDashboard,'admin-products':renderAdminProducts,'admin-categories':renderAdminCategories,'admin-stock':renderAdminStock,'admin-orders':renderAdminOrders,'admin-claims':renderAdminClaims};
 const selectors={home:['#category-grid','#category-count','.category-section-title'],shop:['#shop-grid','.shop-count','.filters','.shop-list-head'],product:['.product-art-stage','.product-purchase-panel','.product-related'],orders:['.orders-tabs','.history-intro-card','.orders-toolbar','#orders-results'],account:['.account-stats','.account-dashboard-panel:last-child'],admin:['.stat-grid','.admin-order-list'], 'admin-products':['.admin-panel'], 'admin-categories':['.admin-panel'], 'admin-stock':['.admin-panel'], 'admin-orders':['.admin-order-list'], 'admin-claims':['.claim-list','.admin-toolbar']};
 if(!renderers[path])return;
 const draft=document.createElement('div');draft.innerHTML=renderers[path]();
 const fresh=draft.firstElementChild,actual=app.firstElementChild;
 if(!fresh||!actual)return;
 for(const selector of (selectors[path]||[]))replaceLivePart(actual,fresh,selector);
 if(path==='product'&&!fresh.querySelector('.product-spotlight')){app.replaceChildren(fresh)}
 setStatus();
}
function refreshLiveWalletUI(){
 setStatus();
 $$('.fx-wallet-balance-value').forEach(el=>{const text=creditText();if(el.textContent!==text)el.textContent=text});
 const amountDialogBalance=$('#wallet-amount-modal .fx-topup-balance strong');if(amountDialogBalance)amountDialogBalance.textContent=creditText();
 const account=$('.account-wallet-preview strong');if(account){const text=creditText();if(account.textContent!==text)account.textContent=text}
 const history=$('.credit-history-rows');if(history){const max=history.closest('.fx-wallet-code-history')?3:5;const html=walletHistoryRows(max);if(history.innerHTML!==html)history.innerHTML=html}
}
function subscribeWalletRealtime(){
 if(!state.ready||!state.user||walletBalanceUnsubscribe||typeof state.F.onSnapshot!=='function')return;
 const uid=state.user.uid;
 walletBalanceUnsubscribe=state.F.onSnapshot(doc('wallets',uid),snap=>{
  if(state.user?.uid!==uid||snap.metadata.fromCache)return;
  const satang=snap.exists()?Number(snap.data()?.balanceSatang||0):0;
  if(!Number.isSafeInteger(satang)||satang<0)return;
  if(state.walletSatang!==satang||!state.walletLoaded){state.walletSatang=satang;state.walletLoaded=true;state.walletError=null;refreshLiveWalletUI()}
 },err=>console.warn('[FIX STORE] wallet live balance:',err));
 walletLedgerUnsubscribe=state.F.onSnapshot(state.F.query(col('wallets',uid,'transactions'),state.F.orderBy('createdAt','desc'),state.F.limit(25)),snap=>{
  if(state.user?.uid!==uid||snap.metadata.fromCache)return;
  const sig=liveSignature(snap);if(sig===liveSignatures.walletLedger)return;liveSignatures.walletLedger=sig;
  state.walletHistory=snap.docs.map(d=>({id:d.id,...d.data(),createdAt:d.data().createdAt?.toDate?.().toISOString()||''}));refreshLiveWalletUI();
 },err=>console.warn('[FIX STORE] wallet transaction stream:',err));
}
function subscribeCatalog(){
 if(!state.ready||typeof state.F.onSnapshot!=='function'||catalogUnsubscribes.length)return;
 const onFailure=(kind,e)=>{console.error('[FIX STORE] live '+kind,e);if(kind==='products')state.productError=e;else state.categoryError=e;toast('ไม่สามารถอัปเดต'+(kind==='products'?'สินค้า':'หมวดหมู่')+'แบบเรียลไทม์: '+errMsg(e),'error')};
 catalogUnsubscribes.push(state.F.onSnapshot(col('products'),snap=>{
  // Cached/offline snapshots may be old. Never delete cart items until the server confirms product availability.
  catalogServerConfirmed=snap.metadata?.fromCache!==true && snap.metadata?.hasPendingWrites!==true;
  const stamp=liveSignature(snap);
  if(stamp!==liveSignatures.products){liveSignatures.products=stamp;state.products=snap.docs.map(d=>({id:d.id,...d.data()}));state.productError=null;scheduleLiveUpdate()}
  if(catalogServerConfirmed)void reconcileUnavailableCartItems();
 },e=>onFailure('products',e)));
 catalogUnsubscribes.push(state.F.onSnapshot(col('categories'),snap=>{const stamp=liveSignature(snap);if(stamp===liveSignatures.categories)return;liveSignatures.categories=stamp;state.categories=snap.docs.map(d=>({id:d.id,...d.data()}));state.categoryError=null;scheduleLiveUpdate()},e=>onFailure('categories',e)));
}
async function loadSettings(){if(!state.ready)return;try{const d=await state.F.getDoc(doc('settings','general'));if(d.exists())state.settings={...state.settings,...d.data()}}catch(e){console.warn('settings',e)}}
// Remove sold-out/disabled/deleted items as soon as Firestore reports authoritative stock changes.
// Manual-delivery items do not require code inventory by design.
function cartItemUnavailable(item){
 const p=state.products.find(product=>product.id===item.id);
 return !p||p.active===false||(!isManual(p)&&num(p.stockCount)<=0);
}
function refreshCartPartial(){
 if(state.current!=='cart'||route().path!=='cart')return;
 const draft=document.createElement('div');draft.innerHTML=renderCart();
 const actual=app.firstElementChild,updated=draft.firstElementChild;
 if(!actual||!updated)return;
 replaceLivePart(actual,updated,'.cart-lines');
 const summary=actual.querySelector('.premium-summary'),freshSummary=updated.querySelector('.premium-summary');
 if(summary&&freshSummary){
  // Preserve the currently typed coupon while updating totals and the cart count.
  if(summary.contains(document.activeElement)&&document.activeElement?.matches?.('input,textarea,select')){
   replaceLivePart(summary,freshSummary,'.summary-head');
   const oldRows=[...summary.querySelectorAll('.summary-row')],newRows=[...freshSummary.querySelectorAll('.summary-row')];
   if(oldRows.length===newRows.length)newRows.forEach((row,i)=>{if(oldRows[i].textContent!==row.textContent)oldRows[i].textContent=row.textContent});
  }else replaceLivePart(actual,updated,'.premium-summary');
 }
}
async function reconcileUnavailableCartItems(){
 if(!catalogServerConfirmed||!state.ready||!state.user||!state.cart.length)return;
 const uid=state.user.uid;
 const removed=state.cart.filter(item=>cartItemUnavailable(item)&&!cartAutoRemovalPending.has(uid+'/'+item.id));
 if(!removed.length)return;
 removed.forEach(item=>cartAutoRemovalPending.add(uid+'/'+item.id));
 const removedIds=new Set(removed.map(item=>item.id));
 state.cart=state.cart.filter(item=>!removedIds.has(item.id));
 state.discountPreview=null; // Discount amount has to be recomputed for a changed cart.
 setStatus();refreshCartPartial();
 toast('นำสินค้าที่หมดสต็อกหรือปิดขาย '+removed.length+' รายการออกจากตะกร้า','warning');
 try{
  const batch=state.F.writeBatch(state.db);
  for(const item of removed)batch.delete(doc('carts',uid,'items',item.id));
  await batch.commit();
 }catch(e){
  console.error('[FIX STORE] auto remove out-of-stock cart:',e);
  toast('ลบสินค้าออกจากตะกร้าบน Firebase ไม่สำเร็จ: '+errMsg(e),'error');
 }finally{removed.forEach(item=>cartAutoRemovalPending.delete(uid+'/'+item.id))}
}
async function loadCart(){
 const userId=state.user?.uid||null;
 state.cart=[];
 if(!state.ready||!userId){setStatus();return}
 try{
  const snap=await state.F.getDocs(col('carts',userId,'items'));
  if(state.user?.uid!==userId)return;
  state.cart=snap.docs.map(d=>({id:d.id,quantity:num(d.data().quantity)}));
 }catch(e){toast('โหลดตะกร้าไม่ได้: '+errMsg(e),'error')}
 setStatus();
 void reconcileUnavailableCartItems();
}
async function loadOrders(admin=false){
 if(!state.ready||(!admin&&!state.user))return;
 try{
  const q=admin?state.F.query(col('orders'),state.F.limit(250)):state.F.query(col('orders'),state.F.where('userId','==',state.user.uid));
  const snap=await state.F.getDocs(q);
  const orders=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  if(admin)state.adminOrders=orders;else state.orders=orders;
 }catch(e){toast('โหลดคำสั่งซื้อไม่ได้: '+errMsg(e),'error')}
}
// Keep the cart synchronized across devices without replacing the page or losing focus.
function subscribeCartRealtime(){
 if(!state.ready||!state.user||cartUnsubscribe||typeof state.F.onSnapshot!=='function')return;
 const uid=state.user.uid;
 cartUnsubscribe=state.F.onSnapshot(col('carts',uid,'items'),snap=>{
  if(state.user?.uid!==uid)return;
  const signature=liveSignature(snap);if(signature===liveSignatures.cart)return;liveSignatures.cart=signature;
  state.cart=snap.docs.map(d=>({id:d.id,quantity:num(d.data().quantity)}));
  setStatus();refreshCartPartial();
  if(catalogServerConfirmed)void reconcileUnavailableCartItems();
 },err=>console.warn('[FIX STORE] realtime cart:',err));
}
// An order may have been deleted in Firestore while its claim document remains.
// Verify existence before hiding an orphaned claim; keep the ledger/audit intact.
const claimOrderVisibility=new Map();
let claimVisibilityRevision=0;
async function verifyAdminClaimOrders(){
 if(!state.admin||!state.ready||!state.F||!state.db)return;
 const revision=++claimVisibilityRevision;
 const ids=[...new Set(state.claims.map(c=>c.orderId).filter(id=>typeof id==='string'&&id.length))];
 const known=new Set(state.adminOrders.map(o=>o.id));
 for(const id of ids){if(known.has(id))claimOrderVisibility.set(id,true);else claimOrderVisibility.delete(id)}
 const needsCheck=ids.filter(id=>!known.has(id));
 // Get each missing-from-list document individually; admin list is capped at 250.
 for(let i=0;i<needsCheck.length;i+=12){
  const chunk=needsCheck.slice(i,i+12);
  const checks=await Promise.allSettled(chunk.map(id=>state.F.getDoc(doc('orders',id))));
  if(revision!==claimVisibilityRevision||!state.admin)return;
  checks.forEach((result,index)=>{
   if(result.status==='fulfilled')claimOrderVisibility.set(chunk[index],result.value.exists());
   else console.warn('[FIX STORE] ตรวจสอบออเดอร์ของเคลมไม่ได้:',result.reason);
  });
 }
 if(revision===claimVisibilityRevision&&state.current==='admin-claims')scheduleLiveUpdate();
}
function visibleAdminClaims(){
 return state.claims.filter(c=>claimOrderVisibility.get(c.orderId)!==false);
}
function subscribeOrders(){
 if(!state.ready||!state.user||orderUnsubscribe)return;
 orderUnsubscribe=state.F.onSnapshot(state.F.query(col('orders'),state.F.where('userId','==',state.user.uid)),snap=>{
  const stamp=liveSignature(snap);if(stamp===liveSignatures.orders)return;liveSignatures.orders=stamp;state.orders=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  if(['orders','account'].includes(state.current))scheduleLiveUpdate();
 },e=>console.warn('Orders stream:',e));
}
function subscribeAdminOrders(){
 if(!state.ready||!state.admin||adminOrderUnsubscribe)return;
 adminOrderUnsubscribe=state.F.onSnapshot(state.F.query(col('orders'),state.F.limit(250)),snap=>{
  const stamp=liveSignature(snap);if(stamp===liveSignatures.adminOrders)return;liveSignatures.adminOrders=stamp;state.adminOrders=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  if(['admin','admin-orders'].includes(state.current))scheduleLiveUpdate();
  if(['admin-claims','admin'].includes(state.current))void verifyAdminClaimOrders();
 },e=>console.warn('Admin orders stream:',e));
}
function subscribeClaims(){
 if(!state.ready||!state.user||claimUnsubscribe)return;
 claimsLoaded=false;
 const uid=state.user.uid;
 const query=state.admin?col('claims'):state.F.query(col('claims'),state.F.where('userId','==',uid));
 claimUnsubscribe=state.F.onSnapshot(query,snap=>{
  if(state.user?.uid!==uid)return;
  const stamp=liveSignature(snap);if(stamp===liveSignatures.claims)return;liveSignatures.claims=stamp;const prev=new Set(state.claims.filter(c=>c.status==='pending').map(c=>c.id));
  const list=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const added=list.filter(c=>c.status==='pending'&&!prev.has(c.id));
  state.claims=list;
  if(state.admin&&claimsLoaded&&added.length){toast('มีคำขอเคลมใหม่ '+added.length+' รายการ');if(state.soundEnabled)playClaimBell()}
  claimsLoaded=true;
  if(state.admin&&['admin-claims','admin'].includes(state.current))void verifyAdminClaimOrders();
  if(['admin-claims','admin','orders','account'].includes(state.current))scheduleLiveUpdate();
 },e=>console.warn('Claims stream:',e));
}
function playClaimBell(){
 try{
  if(!claimSound)return;
  if(claimSound.state==='suspended')void claimSound.resume();
  const t=claimSound.currentTime;
  for(const [f,start] of [[880,0],[1108,.18]]){
   const o=claimSound.createOscillator(),g=claimSound.createGain();
   o.type='sine';o.frequency.setValueAtTime(f,t+start);
   g.gain.setValueAtTime(.0001,t+start);g.gain.exponentialRampToValueAtTime(.10,t+start+.02);g.gain.exponentialRampToValueAtTime(.0001,t+start+.48);
   o.connect(g);g.connect(claimSound.destination);o.start(t+start);o.stop(t+start+.5);
  }
 }catch(e){console.warn('bell:',e)}
}
async function init(){try{const cfg=window.FIXSTORE_FIREBASE_CONFIG;if(!cfg?.apiKey||!cfg?.projectId)throw new Error('ไม่พบไฟล์ Firebase Config');const ver='10.14.1',base=`https://www.gstatic.com/firebasejs/${ver}/`;const [core,A,F]=await Promise.all([import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-firestore.js')]);state.A=A;state.F=F;const fb=core.initializeApp(cfg);state.auth=A.initializeAuth(fb,{persistence:[A.indexedDBLocalPersistence,A.inMemoryPersistence]});state.db=F.initializeFirestore(fb,{localCache:F.memoryLocalCache(),experimentalAutoDetectLongPolling:true});
// Wait until Firebase has restored the previous sign-in BEFORE rendering auth-protected views.
// This avoids briefly showing 'logged out' after a browser refresh.
await new Promise((resolve,reject)=>{let initial=true;A.onAuthStateChanged(state.auth,async user=>{try{const oldUid=state.user?.uid||null;const newUid=user?.uid||null;await setAuthUser(user);if(initial){initial=false;resolve()}else if(oldUid!==newUid&&state.ready)render()}catch(e){if(initial){initial=false;reject(e)}else console.error('Auth state:',e)}},err=>{if(initial){initial=false;reject(err)}else toast('Firebase Auth: '+errMsg(err),'error')})});
state.ready=true;state.error=null;await loadCart();setStatus();render();await Promise.allSettled([loadCategories(),loadProducts(),loadSettings(),loadAnnouncements()]);renderAnnouncements();renderFooter();subscribeAnnouncements();subscribeCatalog();subscribeCartRealtime();subscribeOrders();subscribeAdminOrders();subscribeClaims();subscribeWalletRealtime();if(!['login','register'].includes(state.current))render()}catch(e){state.ready=false;state.error=e;console.error('[FIX STORE] Firebase:',e);setStatus();render();toast('Firebase ไม่พร้อม: '+errMsg(e),'error')}finally{state.loading=false}}
function empty(title,desc,action='shop'){return `<div class="empty-state"><div class="empty-mark">✧</div><h3>${safe(title)}</h3><p>${safe(desc)}</p><a class="btn btn-ghost btn-small" href="${link(action)}">${action==='login'?'เข้าสู่ระบบ':'เลือกดูสินค้า'} ${ico('arrow')}</a></div>`}
// Optional product detail gallery: cover + at most five supplemental HTTPS pictures.
// Legacy products with no galleryImages continue to render the cover alone.
function productGalleryImages(p){
 const cover=https(p?.imageUrl||'');
 const extras=Array.isArray(p?.galleryImages)?p.galleryImages:[];
 const seen=new Set(cover?[cover]:[]);
 const result=cover?[cover]:[];
 for(const raw of extras){
  const src=https(raw);
  if(!src||seen.has(src)||src.length>500)continue;
  seen.add(src);result.push(src);
  if(result.length>=6)break;
 }
 return result;
}
function art(p,cls='product-art'){const src=https(p.imageUrl),soldOut=!purchasable(p);const overlay=soldOut&&['product-art','detail-visual'].includes(cls)?`<span class="soldout-veil" aria-label="สินค้าหมด"><span class="soldout-lux-ribbon"><span class="soldout-lux-ribbon-inner"><span class="soldout-lux-overline">OUT OF STOCK</span><span class="soldout-label">สินค้าหมด</span></span></span></span>`:'';return `<div class="${cls}${soldOut?' is-soldout':''}">${src?`<img loading="${cls==='detail-visual'?'eager':'lazy'}" src="${safe(src)}" alt="${safe(p.name)}">`:`<span class="art-glyph">${safe(p.art||'✦')}</span>`}${overlay}</div>`}
const categoryName=id=>state.categories.find(c=>c.id===id)?.name||LEGACY_CATS[id]||'ไม่ระบุหมวดหมู่';
const allCategories=()=>{const saved=state.categories.map(c=>({...c,legacy:false}));const missing=[...new Set(state.products.map(p=>p.category).filter(Boolean))].filter(id=>!saved.some(c=>c.id===id));return [...saved,...missing.map(id=>({id,name:LEGACY_CATS[id]||'หมวดหมู่เดิม',description:'หมวดหมู่จากสินค้ารุ่นก่อน',active:true,legacy:true,order:999}))].sort((a,b)=>(num(a.order)-num(b.order))||a.name.localeCompare(b.name,'th'))};
const publicCategories=()=>allCategories().filter(c=>c.active!==false);
const activeProducts=()=>state.products.filter(p=>p.active!==false&&state.categories.find(c=>c.id===p.category)?.active!==false);
const categoryProductCount=id=>activeProducts().filter(p=>p.category===id).length;
const categoryCover=c=>{const cover=https(c.coverUrl);return `<span class="category-card-image">${cover?`<img loading="lazy" src="${safe(cover)}" alt="">`:''}</span><span class="category-card-shine"></span><span class="category-watermark" aria-hidden="true">${safe((c.name||'FX').slice(0,2).toUpperCase())}</span><span class="category-card-label">${safe(c.name)}</span><span class="category-card-chevron">${ico('arrow')}</span>`};
function categoryTile(c){const count=categoryProductCount(c.id);return `<article class="category-tile"><a class="category-card" href="${link('shop','category='+encodeURIComponent(c.id))}" aria-label="ดูหมวดหมู่ ${safe(c.name)}">${categoryCover(c)}</a><a href="${link('shop','category='+encodeURIComponent(c.id))}" class="category-tile-info"><span class="category-tile-text"><strong>${safe(c.name)}</strong><small>${safe(c.description||'เลือกดูสินค้าในหมวดหมู่นี้')}</small></span><span class="category-tile-count">${count} สินค้า&nbsp; ${ico('arrow')}</span></a></article>`}

function sorted(products){const list=[...products];if(state.sort==='price-asc')list.sort((a,b)=>num(a.price)-num(b.price));else if(state.sort==='price-desc')list.sort((a,b)=>num(b.price)-num(a.price));else list.sort((a,b)=>Number(!!b.featured)-Number(!!a.featured)||num(a.sort)-num(b.sort));return list}
const deliveryMode=p=>DELIVERY_MODES[p?.deliveryMode]?p.deliveryMode:'instant';
const isManual=p=>deliveryMode(p)==='manual';
const purchasable=p=>isManual(p)||num(p?.stockCount)>0;
function productCard(p){
 const stock=Math.max(0,num(p.stockCount)),soldOut=!purchasable(p);
 const sold=(p.soldCount!=null&&p.soldCount!==''&&Number.isFinite(Number(p.soldCount))&&num(p.soldCount)>=0)?num(p.soldCount):null;
 const badge=String(p.badge||'').trim()||((p.featured===true)?'แนะนำ':'');
 return `<article class="product-card portrait-card product-polished fx-v89-product${soldOut?' product-soldout':''}">
  <div class="portrait-image-frame">
   <a class="product-image-link" href="${link('product','id='+encodeURIComponent(p.id))}" aria-label="ดูรายละเอียด ${safe(p.name)}">${art(p)}</a>
   ${badge?`<span class="fx-v89-product-badge">${safe(badge)}</span>`:''}
  </div>
  <div class="portrait-info">
   <span class="product-category-meta">${safe(categoryName(p.category))}</span>
   <a class="portrait-name-link" href="${link('product','id='+encodeURIComponent(p.id))}"><h3>${safe(p.name)}</h3></a>
   <div class="fx-v89-product-purchase"><strong>${price(p.price)}</strong><span class="fx-v89-product-availability ${soldOut?'is-out':''}">${soldOut?'':isManual(p)?'รอจัดส่ง':`คงเหลือ ${stock.toLocaleString('th-TH')}`}</span></div>
   <div class="portrait-footer fx-v89-product-footer"><small>${sold!==null?`ขายแล้ว ${sold.toLocaleString('th-TH')} รายการ`:'FIX STORE · DIGITAL GOODS'}</small>
    ${soldOut?`<span class="fx-v89-unavailable fx-v89-unavailable-icon" aria-label="สินค้าหมด">${ico('box')}</span>`:`<button type="button" class="portrait-add fx-v89-cart-button" data-action="add-cart" data-id="${safe(p.id)}" title="เพิ่มลงตะกร้า" aria-label="เพิ่ม ${safe(p.name)} ลงตะกร้า">${ico('plus')} <span>เพิ่มลงตะกร้า</span></button>`}
   </div>
  </div>
 </article>`;
}
function categoryPills(current='all'){return `<div class="category-pills">${[{id:'all',name:'สินค้าทั้งหมด'},...publicCategories()].map(c=>`<button class="pill ${current===c.id?'active':''}" type="button" data-action="category" data-category="${safe(c.id)}">${safe(c.name)}</button>`).join('')}</div>`}
// The category landing-page notice line reuses the announcements already managed by admins.
// It is deliberately separate from the site-wide header notice bar.
function homeTickerNotices(){
 let notices=activeNotices();
 if(!notices.length&&!state.announcements.length&&String(state.settings.announcement||'').trim()){
  notices=[{text:state.settings.announcement,href:''}];
 }
 return notices.length?notices:[{text:'ยินดีต้อนรับสู่ FIX STORE',href:''}];
}
function homeTickerMarkup(){
 const notices=homeTickerNotices();
 const repeats=Math.max(3,Math.min(8,Math.ceil(8/notices.length)));
 const pieces=Array.from({length:repeats},()=>notices.map(n=>{
  const text=safe(String(n.text||'').slice(0,180));
  const url=noticeUrl(n.href);
  const inside=`<span class="home-ticker-dot" aria-hidden="true"></span><span>${text}</span>`;
  return url?`<a class="home-ticker-message" href="${safe(url)}" ${url.startsWith('https:')?'target="_blank" rel="noopener noreferrer"':''}>${inside}</a>`:`<span class="home-ticker-message">${inside}</span>`;
 }).join('')).join('');
 return `<div class="home-ticker-track"><div class="home-ticker-set">${pieces}</div><div class="home-ticker-set" aria-hidden="true" inert>${pieces}</div></div>`;
}
function syncHomeTicker(){
 const track=$('#home-ticker');if(!track)return;
 const markup=homeTickerMarkup();if(track.innerHTML!==markup)track.innerHTML=markup;
}
function renderHome(){
 const cats=publicCategories();
 return `<div class="page-in home-v5"><a class="hero-banner" href="${link('shop')}" aria-label="เปิดดูสินค้า FIX STORE"><img src="assets/banner.webp" alt="FIX STORE — Game & Digital Store" fetchpriority="high"></a>
 <div id="home-ticker" class="home-ticker" role="region" aria-label="ประกาศร้าน FIX STORE">${homeTickerMarkup()}</div>
 <section class="category-section category-section-compact"><nav class="breadcrumb category-breadcrumb" aria-label="ตำแหน่งหน้าเว็บ"><a href="${link('home')}">หน้าแรก</a> <span>/</span> หมวดหมู่สินค้า</nav>
 <div class="category-header"><div class="category-section-title"><span class="category-section-icon" aria-hidden="true">${ico('box')}</span><h1 class="category-compact-title">เลือกหมวดหมู่</h1><span class="category-section-count" id="category-count">${cats.length} หมวดหมู่</span></div><label class="category-search">${ico('search')}<input type="search" id="category-search" placeholder="ค้นหาหมวดหมู่..." autocomplete="off" aria-label="ค้นหาหมวดหมู่"></label></div>
 <div class="category-grid" id="category-grid">${cats.length?cats.map(categoryTile).join(''):state.ready?`<div class="category-empty">${ico('box')}<strong>ยังไม่มีหมวดหมู่</strong><p>ผู้ดูแลร้านสามารถสร้างหมวดหมู่และกำหนดรูปภาพจากเมนูหลังร้าน</p>${state.admin?`<a class="btn btn-primary btn-small" href="${link('admin-categories')}">เพิ่มหมวดหมู่ ${ico('arrow')}</a>`:''}</div>`:empty('กำลังเชื่อมต่อ','รอสักครู่ระบบกำลังโหลดข้อมูล Firebase')}</div></section>
   </div>`;
}
const filteredShopProducts=(filterId)=>sorted(activeProducts().filter(p=>(filterId==='all'||p.category===filterId)&&(state.stockFilter==='all'||(state.stockFilter==='available'?purchasable(p):!purchasable(p)))&&`${p.name||''} ${p.description||''}`.toLowerCase().includes(state.search.toLowerCase())));
function renderStockFilters(){return `<div class="stock-filters" aria-label="เลือกสถานะสินค้า">${[['all','ทั้งหมด'],['available','พร้อมขาย'],['out','สินค้าหมด']].map(([id,name])=>`<button type="button" class="stock-filter ${state.stockFilter===id?'active':''}" data-action="stock-filter" data-status="${id}" aria-pressed="${state.stockFilter===id}">${name}</button>`).join('')}</div>`;}
function renderShop(){
 const params=route().params;
 const filterId=params.has('category')?params.get('category'):state.filter;
 if(params.has('category'))state.filter=filterId;
 // The large search/sort panel was removed in V8.9, so keep hidden filters neutral.
 state.search='';state.sort='featured';
 const list=filteredShopProducts(filterId),category=state.categories.find(c=>c.id===filterId),cover=https(category?.coverUrl);
 // All products use the exact same local banner file as the homepage.
 // Specific categories still display their own banner, when configured.
 const isAllProducts=filterId==='all';
 const bannerSrc=isAllProducts?'assets/banner.webp':cover;
 const bannerAlt=isAllProducts?'FIX STORE — Game & Digital Store':categoryName(filterId);
 return `<div class="page-in shop-top fx-v89-shop">
  <div class="section-head fx-v89-shop-head"><div><span class="eyebrow">FIX STORE / CATALOG</span><h1 class="page-title">${isAllProducts?'สินค้าทั้งหมด':safe(categoryName(filterId))}</h1><p>เลือกดูสินค้าและโค้ดเกมที่พร้อมจำหน่ายในร้าน</p></div><a class="fx-v89-category-link" href="${link('home')}">ดูหมวดหมู่สินค้า ${ico('arrow')}</a></div>
  ${bannerSrc?`<div class="catalog-category-cover${isAllProducts?' catalog-category-cover--all':''}"><img src="${safe(bannerSrc)}" alt="${safe(bannerAlt)}" loading="${isAllProducts?'eager':'lazy'}"${isAllProducts?' fetchpriority="high"':''}></div>`:''}
  <div class="fx-v89-catalog-nav" aria-label="หมวดหมู่สินค้า">${categoryPills(filterId)}</div>
  <div class="shop-list-head fx-v89-catalog-list-head"><p class="shop-count">${list.length.toLocaleString('th-TH')} สินค้า</p>${renderStockFilters()}</div>
  <div class="product-grid fx-v89-product-grid" id="shop-grid">${list.length?list.map(productCard).join(''):empty(state.productError?'โหลดสินค้าไม่สำเร็จ':'ไม่พบสินค้า',state.productError?errMsg(state.productError):'ยังไม่มีสินค้าตรงกับตัวกรองนี้')}</div>
 </div>`;
}
function renderProduct(){
 const id=route().params.get('id'),p=activeProducts().find(x=>x.id===id);
 if(!p)return `<div class="page-in">${empty('ไม่พบสินค้านี้','สินค้านี้อาจถูกลบหรือปิดขาย')}</div>`;
 const available=purchasable(p),stock=Math.max(0,num(p.stockCount));
 const related=sorted(activeProducts().filter(q=>q.id!==p.id&&q.category===p.category)).slice(0,4);
 const description=String(p.description||'สินค้าเกมและไอเท็มดิจิทัลจาก FIX STORE').trim();
 return `<div class="page-in product-detail-upgraded product-detail-v73">
  <nav class="product-route" aria-label="ตำแหน่งปัจจุบัน"><a href="${link('home')}">หน้าแรก</a><span aria-hidden="true">/</span><a href="${link('shop','category='+encodeURIComponent(p.category))}">${safe(categoryName(p.category))}</a><span aria-hidden="true">/</span><span class="product-route-current">${safe(p.name)}</span></nav>
  <div class="product-spotlight">
    <div class="product-presentation"><div class="product-art-stage">${art(p,'detail-visual')}<div class="product-stage-glow" aria-hidden="true"></div></div>${productGalleryImages(p).length>1?`<div class="product-gallery-thumbs" role="group" aria-label="รูปเพิ่มเติมของสินค้า ${safe(p.name)}">${productGalleryImages(p).map((src,i)=>`<button type="button" class="product-gallery-thumb${i===0?' is-active':''}" data-action="product-gallery-image" data-gallery-src="${safe(src)}" data-gallery-index="${i}" aria-label="ดูรูปสินค้า ${i+1}" aria-pressed="${i===0?'true':'false'}"><img src="${safe(src)}" alt="รูปที่ ${i+1} ของ ${safe(p.name)}" loading="lazy" decoding="async"></button>`).join('')}</div>`:''}</div>
    <section class="product-purchase-panel">
      <h1>${safe(p.name)}</h1>
      <p class="product-description">${safe(description)}</p>
      <div class="product-availability-mini ${available?'is-available':'is-unavailable'}" role="status" aria-label="สถานะสินค้า">
        <span class="product-availability-mini-label"><i aria-hidden="true"></i>${available?'พร้อมจำหน่าย':'สินค้าหมดชั่วคราว'}</span>
        ${available&&!isManual(p)?`<span class="product-availability-mini-count">คงเหลือ ${stock.toLocaleString('th-TH')} รายการ</span>`:''}
      </div>
      <div class="product-pricing"><div><span>ราคาสินค้า</span><strong>${price(p.price)}</strong></div><span class="product-price-note">ราคาต่อ 1 รายการ</span></div>
      <div class="product-purchase-actions"><button class="btn btn-primary product-buy-btn" type="button" data-action="add-cart" data-id="${safe(p.id)}" ${available?'':'disabled'}>${available?`${ico('bag')} เพิ่มลงตะกร้า ${ico('arrow')}`:'ยังไม่พร้อมจำหน่าย'}</button><a class="btn btn-ghost product-browse-btn" href="${link('shop','category='+encodeURIComponent(p.category))}">ดูสินค้าอื่น ${ico('arrow')}</a></div>
    </section>
  </div>
  ${related.length?`<section class="product-related"><div class="product-related-heading"><div><span class="eyebrow">DISCOVER MORE</span><h2>สินค้าในหมวดเดียวกัน</h2></div><a href="${link('shop','category='+encodeURIComponent(p.category))}">ดูเพิ่มเติม ${ico('arrow')}</a></div><div class="product-grid">${related.map(productCard).join('')}</div></section>`:''}
 </div>`;
}
function authView(mode){const register=mode==='register';return `<div class="page-in auth-frame"><div class="auth-showcase" aria-hidden="true"><div class="auth-showcase-top"><span>FIX STORE</span><span>MEMBERSHIP / 2026</span></div><img class="auth-logo-display" src="assets/logo.webp" alt=""><div class="auth-showcase-bottom"><span>DIGITAL GOODS MARKET</span><span class="cross">✧</span><small>ACCESS TO YOUR GAMES</small></div></div><div class="auth-panel"><a class="auth-back" href="${link('home')}">← กลับหน้าร้าน</a><div class="auth-inner"><div class="auth-kicker">${register?'CREATE YOUR ACCOUNT':'WELCOME BACK'}</div><h1 class="auth-title">${register?'สมัครสมาชิก':'เข้าสู่ระบบ'}</h1><p class="auth-description">${register?'เริ่มต้นซื้อไอเท็มด้วย Username และรหัสผ่าน':'เข้าถึงตะกร้า ประวัติคำสั่งซื้อ และบัญชีของคุณ'}</p><form class="auth-form" id="auth-form" data-mode="${mode}" novalidate><div class="auth-field"><label for="auth-username">ชื่อผู้ใช้ <small>USERNAME</small></label><div class="auth-input-holder"><input id="auth-username" type="text" name="username" placeholder="กรอกชื่อผู้ใช้" autocomplete="username" spellcheck="false" autocapitalize="off" maxlength="20" minlength="4" required><span class="input-ico">${ico('user')}</span></div>${register?'<p class="auth-hint">ตัวอักษร a-z, ตัวเลข และ _ ตั้งแต่ 4–20 ตัว</p>':''}</div><div class="auth-field"><label for="auth-password">รหัสผ่าน <small>PASSWORD</small></label><div class="auth-input-holder"><input id="auth-password" type="password" name="password" placeholder="กรอกรหัสผ่านอย่างน้อย 8 ตัว" autocomplete="${register?'new-password':'current-password'}" minlength="8" required><button data-action="toggle-password" data-target="auth-password" aria-label="แสดงรหัสผ่าน" type="button">${ico('eye')}</button></div></div>${register?`<div class="auth-field"><label for="auth-confirm">ยืนยันรหัสผ่าน <small>CONFIRM PASSWORD</small></label><div class="auth-input-holder"><input id="auth-confirm" type="password" name="confirm" placeholder="กรอกรหัสผ่านอีกครั้ง" autocomplete="new-password" minlength="8" required><button data-action="toggle-password" data-target="auth-confirm" aria-label="แสดงรหัสผ่าน" type="button">${ico('eye')}</button></div></div>`:''}<div class="auth-error" id="auth-error" role="alert" hidden></div><button id="auth-submit" class="auth-submit" type="submit" ${!state.ready?'disabled':''}>${register?'สร้างบัญชีใหม่':'เข้าสู่ระบบ'} ${ico('arrow')}</button></form><p class="auth-switch">${register?'มีบัญชีอยู่แล้ว?':'ยังไม่มีบัญชี?'} <a href="${link(register?'login':'register')}">${register?'เข้าสู่ระบบ':'สมัครสมาชิก'}</a></p><div class="auth-status ${state.ready?'ready':''}" id="auth-status">${state.ready?'เชื่อมต่อ Firebase Authentication แล้ว':state.error?`Firebase ไม่พร้อม: ${safe(errMsg(state.error))}`:'กำลังเชื่อมต่อ Firebase...'}</div></div></div></div>`}
// Wallet presentation only: balance and verification are SERVER controlled.
const walletAmountOptions=[50,100,200,300,500,1000];
function creditText(){return state.walletLoaded?'฿'+(num(state.walletSatang)/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}):'฿—'}
// Show only wallet funding activity here. Purchases/refunds remain in the full ledger
// and order history, but never appear in the compact 'เครดิตล่าสุด' widget.
const WALLET_CREDIT_ACTIVITY_KINDS=new Set(['topup','redeem','admin_adjust']);
function walletHistoryRows(max=8){
 const allowed=state.walletHistory.filter(t=>t&&WALLET_CREDIT_ACTIVITY_KINDS.has(t.kind)).slice(0,max);
 return allowed.map(t=>{
  const incoming=num(t.amountSatang)>=0;
  const label=t.kind==='redeem'?'เติมด้วยโค้ด':t.kind==='admin_adjust'?(incoming?'แอดมินเพิ่มเครดิต':'แอดมินหักเครดิต'):'เติมเงินผ่าน QR';
  const date=t.createdAt?new Date(t.createdAt):null;
  return `<div class="credit-history-row"><div class="credit-history-icon ${incoming?'plus':'minus'}">${incoming?ico('plus'):ico('bag')}</div><div class="credit-history-title"><b>${label}</b><small>${date&&Number.isFinite(date.getTime())?safe(date.toLocaleString('th-TH')):'รายการล่าสุด'}</small></div><strong class="${incoming?'plus':'minus'}">${incoming?'+':'−'}฿${(Math.abs(num(t.amountSatang))/100).toLocaleString('th-TH',{minimumFractionDigits:2})}</strong></div>`;
 }).join('')||'<div class="credit-empty">ยังไม่มีประวัติการเติมหรือปรับเครดิต</div>';
}
function walletBalancePanel(){return `<div class="fx-wallet-balance"><div><small>ยอดเครดิตคงเหลือ</small><strong class="fx-wallet-balance-value">${creditText()}</strong></div><div class="fx-wallet-account"><img src="assets/logo.webp" alt="" width="38" height="38"><span>${safe(state.user.username)}</span></div></div>`;}
function renderWallet(){
 if(!state.user)return guard('เข้าสู่ระบบเพื่อเติมเครดิต','เข้าสู่ระบบก่อนเติมเงินหรือใช้โค้ดเติมเครดิต','login');
 const ready=state.walletConfig?.configured===true;
 const qrStatus=ready?'พร้อมใช้งาน':state.walletError?'ตรวจสอบระบบ':'ตรวจสอบก่อนใช้';
 const qrClass=ready?'ready':'pending';
 const error=state.walletError?`<div class="credit-alert" role="status">${ico('settings')} <span>เชื่อมต่อข้อมูลเครดิตไม่สำเร็จ: ${safe(state.walletError)}</span></div>`:'';
 return `<div class="page-in wallet-choice-page fx-v899-wallet-page">
  <div class="fx-v899-wallet-heading"><span>FIX STORE / WALLET</span><h1>เลือกช่องทางการเติมเงิน</h1><p>เลือกช่องทางที่ต้องการเติมเครดิตเข้าสู่บัญชีของคุณ</p></div>
  <div class="fx-v899-wallet-summary">${walletBalancePanel()}</div>
  <section class="fx-v899-method-list" aria-label="ช่องทางการเติมเงิน">
   <button type="button" class="fx-v899-method" data-action="wallet-open-topup">
    <span class="fx-v899-method-icon qr" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><rect x="6" y="6" width="11" height="11" rx="2" stroke="currentColor" stroke-width="3"/><rect x="23" y="6" width="11" height="11" rx="2" stroke="currentColor" stroke-width="3"/><rect x="6" y="23" width="11" height="11" rx="2" stroke="currentColor" stroke-width="3"/><path d="M23 23h5v5h-5zM34 24v10h-5M23 34h4" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg></span>
    <span class="fx-v899-method-copy"><strong>เติมเงินผ่าน QR พร้อมเพย์</strong><small>ค่าธรรมเนียม 0% · สแกน QR และแนบสลิปเพื่อยืนยัน</small></span><span class="fx-v899-method-badge ${qrClass}">${ico('check')} ${qrStatus}</span><span class="fx-v899-method-chevron">${ico('arrow')}</span>
   </button>
   <a class="fx-v899-method" href="${link('wallet-code')}">
    <span class="fx-v899-method-icon code" aria-hidden="true">${ico('ticket')}</span><span class="fx-v899-method-copy"><strong>เติมเงินผ่านโค้ด</strong><small>กรอกรหัสเติมเครดิตของ FIX STORE · ไม่เสียค่าธรรมเนียม</small></span><span class="fx-v899-method-badge ready">${ico('check')} พร้อมใช้งาน</span><span class="fx-v899-method-chevron">${ico('arrow')}</span>
   </a>
  </section><p class="fx-v899-method-footnote">เครดิตจะเพิ่มหลังจากระบบยืนยันรายการสำเร็จเท่านั้น</p>${error}
 </div>`;
}

function renderWalletMethod(method){
 if(!state.user)return guard('เข้าสู่ระบบเพื่อเติมเครดิต','เข้าสู่ระบบก่อนทำรายการ','login');
 const qr=method==='qr',enabled=state.walletConfig?.configured===true;
 const content=qr?`<div class="fx-wallet-method-hero"><div class="credit-method-head fx-wallet-method-head"><span class="credit-step">01</span><div><h2>เติมผ่าน QR พร้อมเพย์</h2><p>เลือกจำนวนเงิน สร้าง QR และทำรายการในหน้าต่าง 2 ขั้นตอนที่ออกแบบใหม่ให้ใช้งานง่ายขึ้น</p></div></div><div class="fx-wallet-method-tags"><span>${ico('check')} 2 Step Checkout</span><span>${ico('clock')} QR ใช้ได้ 5 นาที</span><span>${ico('bag')} รองรับ SlipOK</span></div></div>
 <div class="fx-wallet-amount-shell"><div class="fx-wallet-amount-title"><strong>เลือกจำนวนเงินที่ต้องการเติม</strong><small>หรือกรอกจำนวนเองได้ตั้งแต่ 10 - 5,000 บาท</small></div><div class="credit-amount-picks fx-wallet-amount-picks">${walletAmountOptions.map(n=>`<button type="button" data-action="wallet-select-amount" data-amount="${n}" class="credit-amount-choice ${num(state.walletAmount)===n?'active':''}"><small>เติม</small><b>฿${n.toLocaleString('th-TH')}</b></button>`).join('')}</div>
 <form id="wallet-intent-form" class="credit-qr-form fx-wallet-intent-form"><label>กำหนดจำนวนเงิน (บาท)<span class="fx-v899-inline-amount"><span aria-hidden="true">฿</span><input class="input" type="number" name="amount" min="10" max="5000" step="1" value="${num(state.walletAmount)||100}" aria-label="จำนวนเงินที่ต้องการเติมเป็นบาท" required></span></label><button id="wallet-create-qr-button" class="btn btn-primary credit-main-btn fx-wallet-create-btn" type="submit" ${enabled?'':'disabled'}>${ico('arrow')} สร้าง QR ชำระเงิน</button></form>
 <div class="credit-inline-note wallet-qr-status-note" id="wallet-qr-status" role="status" ${enabled?'hidden':''}><span id="wallet-qr-status-text">${safe(walletQrStatusText())}</span><button type="button" class="wallet-qr-retry" data-action="wallet-retry-qr">ตรวจสอบอีกครั้ง ${ico('arrow')}</button></div></div>`:
 `<div class="fx-wallet-method-hero"><div class="credit-method-head fx-wallet-method-head"><span class="credit-step">01</span><div><h2>เติมเครดิตด้วยโค้ด</h2><p>กรอกรหัสเติมเครดิตของ FIX STORE ที่ยังไม่เคยใช้งาน เพื่อเพิ่มเครดิตเข้าสู่บัญชีนี้</p></div></div><div class="fx-wallet-method-tags"><span>${ico('ticket')} Redeem Secure</span><span>${ico('check')} ใช้งานได้ครั้งเดียว</span><span>${ico('bag')} เติมเข้าอัตโนมัติ</span></div></div>
 <p class="wallet-redeem-caption">กรอกรหัสสำหรับบัญชีนี้ รหัสเติมเครดิตแต่ละชุดใช้ได้เพียงครั้งเดียว</p>
 <form id="redeem-code-form" class="credit-redeem-form fx-wallet-redeem-form"><label for="redeem-code-input">โค้ดเติมเครดิต</label><input id="redeem-code-input" class="input" type="text" name="code" inputmode="text" spellcheck="false" autocomplete="off" autocapitalize="characters" placeholder="FXS-XXXX-XXXX-XXXX-XXXX" maxlength="32" required><button class="btn btn-primary credit-main-btn fx-wallet-create-btn" type="submit">${ico('check')} ยืนยันเติมเครดิต</button></form>`;
 const steps=qr?['เลือกจำนวนเงินที่ต้องการเติม','กดสร้าง QR และโอนเงินตามยอดที่ระบุ','เมื่อโอนเสร็จ กดไปขั้นตอนแนบสลิป','ระบบตรวจสอบสลิปก่อนเพิ่มเครดิตเข้าบัญชี']:['รับโค้ดเติมเครดิตจากร้าน','กรอกโค้ดในช่องด้านซ้าย','ระบบตรวจสอบโค้ดว่าใช้ได้และยังไม่ถูกใช้','เมื่อผ่านแล้วเครดิตจะเข้ากระเป๋าทันที'];
 const error=state.walletError?`<div class="credit-alert" role="status">${ico('settings')} <span>${safe(state.walletError)}</span></div>`:'';
 return `<div class="page-in credit-page fx-wallet-method-page fx-v89-wallet-method fx-wallet-premium-method"><div class="fx-wallet-method-top"><a class="fx-wallet-back" href="${link('wallet')}">← เลือกช่องทางอื่น</a><span class="eyebrow">FIX STORE / ${qr?'QR PROMPTPAY':'REDEEM CODE'}</span></div><div class="credit-page-heading fx-wallet-page-heading"><div><h1>${qr?'เติมเงินผ่าน QR พร้อมเพย์':'ใช้โค้ดเติมเครดิต'}</h1><p>ดีไซน์ใหม่ที่โฟกัสความชัดเจนของขั้นตอน ใช้งานง่าย และดูพรีเมียมมากขึ้น</p></div></div>${walletBalancePanel()}
 <div class="credit-workspace fx-wallet-workspace ${qr?'is-qr':'is-code'}"><section class="credit-method-panel fx-wallet-main-panel">${content}</section>${qr?`<aside class="credit-right-stack fx-wallet-side-stack"><section class="credit-info-panel fx-wallet-side-panel"><div class="credit-info-heading"><span class="credit-mini-icon">${ico('check')}</span><h3>ขั้นตอนการเติมเครดิต</h3></div><ol class="credit-instructions fx-wallet-instructions">${steps.map(step=>`<li>${step}</li>`).join('')}</ol><p class="credit-disclaimer">โปรดตรวจสอบยอดและชื่อบัญชีผู้รับเงินก่อนโอนทุกครั้ง และอย่าใช้สลิปเดิมซ้ำ</p></section><section class="credit-info-panel fx-wallet-side-panel"><div class="credit-info-heading"><span class="credit-mini-icon">${ico('box')}</span><h3>เครดิตล่าสุด</h3><button class="credit-refresh-btn" data-action="wallet-refresh" type="button">รีเฟรช</button></div><div class="credit-history-rows">${walletHistoryRows(5)}</div></section></aside>`:`<aside class="credit-right-stack fx-wallet-side-stack"><section class="credit-info-panel fx-wallet-side-panel fx-wallet-code-history"><div class="credit-info-heading"><h3>เครดิตล่าสุด</h3><button class="credit-refresh-btn" data-action="wallet-refresh" type="button">รีเฟรช</button></div><div class="credit-history-rows">${walletHistoryRows(3)}</div></section></aside>`}</div>${error}</div>`;
}

function walletApiBase(){
 const explicit=String(window.FIXSTORE_API_BASE||'').trim();
 if(explicit){
  if(explicit.includes('REPLACE-WITH-YOUR-CLOUD-RUN-URL'))throw Error('ยังไม่ได้ตั้งค่า Cloud Run URL ใน js/firebase-config.js');
  if(!/^https:\/\/[^/\s]+$/.test(explicit.replace(/\/+$/,'')))throw Error('Cloud Run URL ต้องเป็นที่อยู่ HTTPS ไม่มี /api ต่อท้าย');
  return explicit.replace(/\/+$/,'');
 }
 if(location.hostname.endsWith('.github.io'))throw Error('GitHub Pages ต้องกำหนด FIXSTORE_API_BASE เป็น Cloud Run URL ก่อนใช้งานระบบเครดิต');
 if(location.protocol==='http:'||location.protocol==='https:')return location.origin;
 return 'http://127.0.0.1:8787';
}
async function walletApi(path,opts={}){
 if(!state.auth?.currentUser)throw Error('กรุณาเข้าสู่ระบบก่อนทำรายการ');
 const token=await state.A.getIdToken(state.auth.currentUser);
 const headers=new Headers(opts.headers||{});headers.set('Authorization','Bearer '+token);
 if(opts.body&&typeof opts.body==='string')headers.set('Content-Type','application/json');
 let resp;const backend=walletApiBase();try{resp=await fetch(backend+path,{...opts,headers,cache:'no-store'})}catch{throw Error('เชื่อมต่อ Cloud Run ไม่ได้ ตรวจสอบ URL, CORS (ALLOWED_ORIGINS) และสถานะบริการ')}
 const result=await resp.json().catch(()=>({}));
 if(!resp.ok){
  if(resp.status===404&&/^\/api\/admin\/claims\/[^/]+\/refund$/.test(path)){
   throw Error('ไม่พบ API คืนเครดิต (404) — ตรวจว่า Cloud Run ใช้ Backend รุ่นที่มี Refund API และ FIXSTORE_API_BASE ชี้ไปบริการถูกตัว');
  }
  throw Error(result.error||'Backend ตอบกลับ '+resp.status);
 }
 return result;
}
function walletQrStatusText(){
 if(state.walletError)return 'ตรวจสอบ QR ไม่สำเร็จ: '+state.walletError;
 const problems={promptpay_missing:'Backend ยังไม่ได้อ่าน PROMPTPAY_ID จาก server/.env',promptpay_invalid:'PROMPTPAY_ID ต้องเป็นเลข 10 หรือ 13 หลัก ไม่มีช่องว่างหรือขีด',firebase_missing:'Firebase Admin ยังไม่พร้อม: ตรวจสอบ serviceAccountKey.json หรือ GOOGLE_APPLICATION_CREDENTIALS'};
 return problems[state.walletConfig?.reason]||'กำลังตรวจสอบ Backend หรือยังไม่ได้รับสถานะ QR';
}
function syncWalletQrStatus(){
 // Fix: wallet configuration may finish loading *after* the wallet page has rendered.
 const btn=$('#wallet-create-qr-button'),note=$('#wallet-qr-status'),message=$('#wallet-qr-status-text');
 const ready=state.walletConfig?.configured===true;
 if(btn)btn.disabled=!ready;
 if(note)note.hidden=ready;
 if(message)message.textContent=walletQrStatusText();
}
async function loadWallet(update=true){
 if(!state.user)return;
 try{
  state.walletError=null;
  const result=await walletApi('/api/wallet');
  state.walletSatang=num(result.balanceSatang);
  state.walletLoaded=true;
  state.walletHistory=Array.isArray(result.transactions)?result.transactions:[];
  state.walletConfig={configured:result.canCreateQR===true,reason:String(result.qrStatus||'')};
 }catch(e){state.walletError=e.message;state.walletLoaded=false;state.walletConfig={configured:false,reason:'api_error'}}
 setStatus();
 if(update)refreshLiveWalletUI();
 syncWalletQrStatus();
 refreshWalletAmountDialog();
}
async function createWalletIntent(form){if(state.busy)return;const amount=Number(new FormData(form).get('amount'));if(!Number.isInteger(amount)||amount<10||amount>5000)return toast('เติมขั้นต่ำ 10 บาท และสูงสุด 5,000 บาท','error');state.busy=true;const btn=form.querySelector('button[type=submit]');busyButton(btn,true);try{const data=await walletApi('/api/deposits/intent',{method:'POST',body:JSON.stringify({amount})});state.walletIntent=data;closeWalletAmountModal();openWalletModal(data)}catch(e){toast(e.message,'error')}finally{state.busy=false;busyButton(btn,false)}}
let walletCountdownHandle=null,walletDeadlineMs=0,walletSlipPreviewUrl=null;
function stopWalletCountdown(){if(walletCountdownHandle!==null){clearInterval(walletCountdownHandle);walletCountdownHandle=null}walletDeadlineMs=0}
function syncWalletToastPlacement(){
 const host=$('#toast-area');if(!host)return;
 host.classList.toggle('fx-topup-toast-active',!!($('#wallet-amount-modal')||$('#wallet-modal')));
}
function closeWalletAmountModal(){document.getElementById('wallet-amount-modal')?.remove();syncWalletToastPlacement()}

function closeWalletModal(){stopWalletCountdown();if(walletSlipPreviewUrl){URL.revokeObjectURL(walletSlipPreviewUrl);walletSlipPreviewUrl=null;}$('#wallet-modal')?.remove();state.walletIntent=null;syncWalletToastPlacement()}
function walletTimeLeftMs(){return Math.max(0,walletDeadlineMs-Date.now())}
function updateWalletCountdown(){
 const modal=$('#wallet-modal'),display=$('#wallet-countdown');
 if(!modal||!display){stopWalletCountdown();return}
 const left=walletTimeLeftMs(),remaining=Math.ceil(left/1000);
 display.textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
 display.setAttribute('aria-label','เวลาทำรายการคงเหลือ '+Math.floor(remaining/60)+' นาที '+remaining%60+' วินาที');
 const step2Display=$('#wallet-countdown-step2');if(step2Display)step2Display.textContent=display.textContent;
 modal.classList.toggle('wallet-qr-expired',left<=0);
 const submit=$('#wallet-slip-form button[type=submit]'),input=$('#wallet-slip-input'),down=modal.querySelector('[data-action=wallet-download-qr]');
 if(left<=0){
  if(submit){submit.disabled=true;submit.textContent='QR หมดอายุ · สร้างรายการใหม่'}
  if(input)input.disabled=true;
  if(down)down.disabled=true;
  if(walletCountdownHandle!==null){clearInterval(walletCountdownHandle);walletCountdownHandle=null}
 }
}
// V8.9.5 emergency: prevent an unstyled checkout if the optional topup CSS file is missing or stale.
// This stylesheet is bundled in the existing JS and uses only local, non-secret presentation rules.
const FIX_STORE_TOPUP_FALLBACK_CSS = "/* FIX STORE V8.9.4 — reference-style white/red PromptPay dialogs.\n   Presentation only; wallet balance, payment intent, timer and verification\n   remain controlled by the original authenticated backend. */\n.fx-topup-open-card{width:100%;text-align:left;color:inherit;font:inherit;cursor:pointer}\n.fx-topup-backdrop{position:fixed!important;inset:0!important;z-index:6000!important;display:flex!important;justify-content:center!important;align-items:center!important;background:rgba(11,11,12,.79)!important;backdrop-filter:blur(8px)!important;-webkit-backdrop-filter:blur(8px)!important;padding:18px!important;overflow-y:auto;overscroll-behavior:contain}\n.fx-topup-backdrop .fx-topup-dialog,\n.fx-topup-backdrop .wallet-modal.wallet-payment-dialog.fx-v89-payment-dialog.fx-topup-dialog{\n  position:relative!important;flex:0 1 auto!important;display:block!important;\n  width:min(516px,100%)!important;max-width:516px!important;\n  max-height:calc(100dvh - 36px)!important;overflow-x:hidden!important;overflow-y:auto!important;\n  margin:auto!important;padding:0!important;background:#fff!important;color:#171717!important;\n  border:1px solid #e9e9ed!important;border-radius:16px!important;\n  box-shadow:0 24px 80px rgba(0,0,0,.32)!important;\n  font-family:'Anuphan',system-ui,sans-serif!important;\n  animation:fxTopupPop .29s cubic-bezier(.2,.82,.2,1) both;\n}\n.fx-topup-dialog *{box-sizing:border-box}\n.fx-topup-dialog .fx-topup-header,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-title.fx-topup-header{\n  display:flex!important;align-items:center!important;justify-content:space-between!important;\n  gap:16px!important;min-height:72px!important;padding:19px 27px 13px!important;\n  margin:0!important;background:#fff!important;border:none!important;\n}\n.fx-topup-dialog .fx-topup-header h2,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-title h2{\n  font-family:'Anuphan',sans-serif!important;font-size:19px!important;line-height:1.45!important;\n  font-weight:800!important;letter-spacing:-.045em!important;color:#151515!important;margin:0!important;\n}\n.fx-topup-dialog .fx-topup-close,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-close.fx-topup-close{\n  display:grid!important;place-items:center!important;flex:none!important;width:28px!important;height:28px!important;\n  padding:0!important;margin:0!important;line-height:1!important;font-size:20px!important;font-weight:400!important;\n  border:1px solid #f0aaaa!important;color:#c52a31!important;border-radius:8px!important;\n  background:#fff!important;cursor:pointer!important;transition:background .18s,border-color .18s,transform .18s;\n}\n.fx-topup-dialog .fx-topup-close:hover{background:#fff1f1!important;border-color:#e52b34!important;transform:rotate(90deg)}\n.fx-topup-dialog :is(button,input):focus-visible{outline:3px solid rgba(218,33,42,.35)!important;outline-offset:3px!important}\n.fx-topup-dialog button{font-family:inherit;cursor:pointer}\n.fx-topup-content{padding:4px 27px 28px}\n.fx-topup-balance{display:flex;align-items:center;gap:15px;min-height:82px;border:1px solid #ffd4d7;background:linear-gradient(180deg,#fffcfc,#f4f8ff);border-radius:13px;padding:17px 16px;margin:5px 0 22px}\n.fx-topup-balance-icon{display:grid;place-items:center;flex:none;width:43px;height:43px;border-radius:999px;background:#ffe8e9;color:#e02630}\n.fx-topup-balance-icon svg{width:22px;height:22px}\n.fx-topup-balance>div{display:grid;gap:2px}\n.fx-topup-balance small{font-size:12px;color:#858585}\n.fx-topup-balance strong{font-size:18px;color:#2f6df6;font-weight:800;line-height:1.4}\n.fx-topup-amount-form{display:grid;gap:0;color:#161616}\n.fx-topup-amount-form>label{font-size:14px;font-weight:750;margin-bottom:12px}\n.fx-topup-amount-field{display:flex;align-items:center;gap:12px;height:50px;border:1px solid #dedee2;background:#fff;border-radius:8px;box-shadow:0 2px 3px #00000005;transition:border-color .2s,box-shadow .2s}\n.fx-topup-amount-field:focus-within{border-color:#ed4952;box-shadow:0 0 0 3px rgba(224,34,42,.09)}\n.fx-topup-amount-field>span{padding-left:14px;color:#6d6d72;font-size:15px}\n.fx-topup-amount-field input{width:100%;min-width:0;border:none!important;outline:none!important;box-shadow:none!important;background:transparent!important;color:#151515!important;appearance:textfield;-moz-appearance:textfield;font-family:inherit;font-size:18px;font-weight:800;padding:8px 12px 8px 0}\n.fx-topup-amount-field input::-webkit-inner-spin-button,.fx-topup-amount-field input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}\n.fx-topup-hint{margin:9px 0 18px;font-size:11px;color:#8b8b8b;line-height:1.5}\n.fx-topup-preset-heading{color:#757575;font-size:12px;font-weight:500;margin-bottom:10px}\n.fx-topup-preset-list{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:19px}\n.fx-topup-preset-list>button{height:43px;min-width:0;background:#fff;color:#242424;border:1px solid #e1e1e5;border-radius:9px;font-size:13px;font-weight:700;transition:background .17s,border-color .17s,transform .17s,box-shadow .17s}\n.fx-topup-preset-list>button:hover{border-color:#ec6c72;transform:translateY(-1px)}\n.fx-topup-preset-list>button.selected{background:#e5212b;color:#fff;border-color:#e5212b;box-shadow:0 5px 12px rgba(229,33,43,.16)}\n.fx-topup-info{display:flex;align-items:center;gap:10px;min-height:43px;padding:10px 13px;margin-bottom:18px;border:1px dashed #e3e3e6;border-radius:9px;background:#fafafa;color:#8a8a8a;font-size:11px;line-height:1.6}\n.fx-topup-info svg{flex:none;width:13px;height:13px;color:#d82e36}\n.fx-topup-status{display:grid;gap:10px;margin-bottom:13px;border:1px solid #ffccd0;border-radius:10px;padding:10px 12px;background:#f4f8ff;color:#a91e29;font-size:11px}\n.fx-topup-status[hidden]{display:none!important}\n.fx-topup-status button{justify-self:start;border:1px solid #e8a5a9;border-radius:7px;background:#fff;padding:7px 10px;color:#b2222b;font-weight:700}\n.fx-topup-primary,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-next-step.fx-topup-primary,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-submit-payment.fx-topup-primary{\n  display:flex!important;align-items:center!important;justify-content:center!important;gap:9px!important;\n  width:100%!important;min-height:47px!important;padding:10px 16px!important;\n  background:#2f6df6!important;color:#fff!important;border:1px solid #2f6df6!important;\n  border-radius:8px!important;box-shadow:0 5px 12px rgba(230,29,39,.11)!important;\n  font-size:13px!important;font-weight:800!important;line-height:1.4!important;\n  transition:background .18s,box-shadow .18s,transform .18s!important;\n}\n.fx-topup-primary svg{width:16px;height:16px}\n.fx-topup-primary:hover:not(:disabled){background:#2563eb!important;box-shadow:0 7px 18px rgba(59,130,246,.22)!important;transform:translateY(-1px)!important}\n.fx-topup-primary:active:not(:disabled){transform:translateY(0)!important}\n.fx-topup-primary:disabled{opacity:.48!important;cursor:not-allowed!important}\n/* PromptPay QR confirmation dialog */\n.fx-topup-backdrop .fx-topup-qr-dialog{width:min(520px,100%)!important;max-width:520px!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-wizard{padding:0!important;background:#fff!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-stage,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-qr-section,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-slip-form.wallet-payment-slip-section{\n  background:#fff!important;border:0!important;padding:6px 27px 27px!important;display:block;\n  color:#171717!important;\n}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-stage[hidden]{display:none!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-stage.is-active{animation:fxTopupPanelIn .3s ease both}\n.fx-topup-payment-amount{text-align:center;background:#f4f8ff;border:1px solid #cfe0ff;border-radius:13px;padding:12px 20px 14px;margin:0 0 17px}\n.fx-topup-payment-amount small{display:block;margin:0 0 2px;font-size:12px;color:#9a8c8d}\n.fx-topup-payment-amount strong{display:block;font-size:24px;color:#2f6df6;line-height:1.2;font-weight:800}\n.fx-topup-qr-wrap{display:grid;place-items:center}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-qr-stage{\n  display:grid!important;place-items:center!important;width:min(276px,100%)!important;\n  min-height:276px!important;max-height:none!important;padding:18px!important;\n  background:#fff!important;border:1px solid #e5e5e8!important;border-radius:17px!important;box-shadow:0 1px 3px #00000009!important;\n}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-qr-paper{display:grid!important;place-items:center!important;padding:0!important;background:#fff!important;border:0!important;border-radius:0!important;box-shadow:none!important}\n.fx-topup-backdrop .fx-v89-payment-dialog #wallet-promptpay-qr{display:block!important;width:238px!important;height:238px!important;max-width:100%!important;object-fit:contain!important;image-rendering:auto}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-qr-download.fx-topup-secondary{display:flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;width:auto!important;min-height:37px!important;height:auto!important;min-width:175px!important;margin:15px auto 12px!important;padding:9px 15px!important;color:#303030!important;font-size:12px!important;font-weight:650!important;background:#fff!important;border:1px solid #e0e0e4!important;border-radius:8px!important;box-shadow:0 2px 4px rgba(0,0,0,.04)!important;transition:border-color .18s,transform .18s!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-qr-download:hover{border-color:#b0cbff!important;transform:translateY(-1px)}\n.fx-topup-qr-caution{font-size:11px;color:#2d68da;line-height:1.5;text-align:center;margin:0 0 10px}\n.fx-topup-clock{display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;color:#8c8c8c;line-height:1.5;margin:0 0 15px}\n.fx-topup-clock b{font-variant-numeric:tabular-nums;color:#2d68da;font-weight:800;font-size:13px}\n.fx-topup-clock-dot{display:block;width:9px;height:9px;border-radius:50%;border:2px solid #a8c5ff;border-top-color:#e3222f;animation:fxTopupSpin 1.1s linear infinite}\n.fx-topup-bottom-actions{display:grid;gap:10px}\n.fx-topup-link{width:100%;font-size:12px!important;line-height:1.5;padding:7px 12px;color:#848484!important;background:transparent!important;border:0!important;transition:color .18s}\n.fx-topup-link:hover{color:#3b82f6!important}\n.fx-topup-receipt-amount{margin-bottom:13px}\n.fx-topup-slip-intro{font-size:12px;color:#777;text-align:center;line-height:1.65;margin:0 0 15px}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-slip-form.wallet-payment-slip-section .wallet-upload-zone.fx-topup-upload{\n  display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;\n  gap:8px!important;padding:20px!important;margin:0 0 15px!important;min-height:185px!important;\n  background:#fff!important;border:1px dashed #bfd2ff!important;border-radius:14px!important;\n  color:#242424!important;cursor:pointer!important;transition:border-color .2s,background .2s,transform .2s!important;\n}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-slip-form .wallet-upload-zone:hover{border-color:#2f6df6!important;background:#f7faff!important;transform:translateY(-1px)}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-graphic{width:48px!important;height:48px!important;display:grid!important;place-items:center!important;border-radius:15px!important;color:#2f6df6!important;background:#eef4ff!important;border:0!important;box-shadow:none!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-graphic svg{width:22px;height:22px}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-zone strong{font-size:13px!important;line-height:1.5!important;color:#1b1b1b!important;max-width:100%!important;overflow-wrap:anywhere}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-zone small{font-size:11px!important;line-height:1.4!important;color:#9a9a9a!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-browse{display:inline-flex!important;align-items:center!important;gap:7px!important;border-radius:8px!important;background:#edf4ff!important;color:#2d68da!important;font-size:12px!important;padding:9px 14px!important;margin-top:3px!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-zone.has-file{background:#fff9f9!important;border-color:#5c8ff8!important}\n.fx-topup-backdrop .fx-v89-payment-dialog #wallet-slip-preview{max-height:155px;width:auto;max-width:100%;object-fit:contain;border-radius:9px;border:1px solid #eee;margin:3px auto}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-verify-footnote{font-size:11px!important;color:#909090!important;text-align:center!important;margin:9px 0 0!important;line-height:1.6!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-expired-message{margin:15px 0 0!important;border:1px solid #c8dbff!important;border-radius:12px!important;background:#f5f8ff!important;color:#2557c5!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-expired-message span{color:#4771c9!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-qr-expired .wallet-payment-qr-stage{filter:grayscale(1)}\n@keyframes fxTopupPop{from{opacity:0;transform:translateY(16px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}\n@keyframes fxTopupPanelIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}\n@keyframes fxTopupSpin{to{transform:rotate(360deg)}}\n@media (max-width:600px){\n .fx-topup-backdrop{padding:10px!important;align-items:center!important}\n .fx-topup-backdrop .fx-topup-dialog,.fx-topup-backdrop .wallet-modal.wallet-payment-dialog.fx-v89-payment-dialog.fx-topup-dialog{max-height:calc(100dvh - 20px)!important;width:100%!important;max-width:516px!important;border-radius:14px!important}\n .fx-topup-dialog .fx-topup-header,.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-title.fx-topup-header{min-height:66px!important;padding:18px 20px 11px!important}\n .fx-topup-dialog .fx-topup-header h2,.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-title h2{font-size:17px!important}\n .fx-topup-content{padding:3px 20px 23px}\n .fx-topup-balance{margin-bottom:18px}\n .fx-topup-preset-list{gap:6px}\n .fx-topup-preset-list button{height:42px;font-size:12px}\n .fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-stage,.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-qr-section,.fx-topup-backdrop .fx-v89-payment-dialog .wallet-slip-form.wallet-payment-slip-section{padding:4px 20px 21px!important}\n .fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-qr-stage{width:min(250px,100%)!important;min-height:250px!important;padding:14px!important}\n .fx-topup-backdrop .fx-v89-payment-dialog #wallet-promptpay-qr{width:220px!important;height:220px!important}\n .fx-topup-payment-amount strong{font-size:22px}\n}\n@media (max-height:670px){.fx-topup-backdrop{align-items:flex-start!important}.fx-topup-backdrop .fx-topup-dialog{margin:auto!important}}\n@media (prefers-reduced-motion:reduce){.fx-topup-dialog,.fx-topup-dialog *{animation:none!important;transition:none!important}}\n\n\n/* FIX STORE V8.9.8 — Graphite payment dialogs, consistent with storefront dark/silver. */\n.fx-topup-backdrop .fx-topup-dialog,\n.fx-topup-backdrop .wallet-modal.wallet-payment-dialog.fx-v89-payment-dialog.fx-topup-dialog{\n color:#eef0f4!important;background:#14171b!important;border-color:#383e48!important;\n border-radius:19px!important;box-shadow:0 32px 85px rgba(0,0,0,.64),inset 0 1px rgba(255,255,255,.055)!important;\n color-scheme:dark!important;\n}\n.fx-topup-dialog .fx-topup-header,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-title.fx-topup-header{\n background:#14171b!important;border-bottom:1px solid #2b3139!important;\n}\n.fx-topup-dialog .fx-topup-header h2,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-title h2{color:#f5f6f8!important}\n.fx-topup-dialog .fx-topup-close,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-close.fx-topup-close{\n color:#b9c2ce!important;background:#1d222a!important;border-color:#424b58!important;border-radius:9px!important;\n}\n.fx-topup-dialog .fx-topup-close:hover,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-close.fx-topup-close:hover{color:#fff!important;background:#2d3540!important;border-color:#7b8797!important}\n.fx-topup-dialog :is(button,input):focus-visible{outline:2px solid #d9e1ec!important;outline-offset:2px!important}\n.fx-topup-content,.fx-topup-amount-form{color:#e7ebf0!important}\n.fx-topup-balance{background:linear-gradient(130deg,#222832,#1b2027)!important;border-color:#3b434f!important;border-radius:14px!important}\n.fx-topup-balance-icon{color:#e9edf4!important;background:#333c48!important}\n.fx-topup-balance small,.fx-topup-hint,.fx-topup-preset-heading{color:#9ea9b7!important}\n.fx-topup-balance strong{color:#f5f7fa!important}\n.fx-topup-amount-form>label{color:#eff1f4!important}\n.fx-topup-amount-field{background:#101419!important;border-color:#404852!important;box-shadow:none!important;border-radius:11px!important}\n.fx-topup-amount-field:focus-within{border-color:#bdc7d4!important;box-shadow:0 0 0 3px #b7c6d419!important}\n.fx-topup-amount-field>span{color:#a1acb8!important}\n.fx-topup-amount-field input{color:#eff2f7!important}\n.fx-topup-preset-list>button{background:#1d2229!important;color:#dce1e8!important;border-color:#3c444f!important;border-radius:11px!important}\n.fx-topup-preset-list>button:hover{background:#29303a!important;border-color:#7f8b9a!important}\n.fx-topup-preset-list>button.selected{color:#15191e!important;background:#e8ebf1!important;border-color:#e8ebf1!important;box-shadow:0 9px 22px #0004!important}\n.fx-topup-info{background:#1b2027!important;border-color:#3d4550!important;color:#a6b0bc!important;border-radius:11px!important}\n.fx-topup-info svg{color:#c9d2dc!important}\n.fx-topup-status{background:#35242a!important;border-color:#67414b!important;color:#ffccd2!important}\n.fx-topup-status button{background:#30252b!important;color:#ffdadf!important;border-color:#80505c!important}\n.fx-topup-dialog .fx-topup-primary,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-next-step.fx-topup-primary,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-submit-payment.fx-topup-primary{\n background:linear-gradient(125deg,#f5f6f8,#d0d5dd)!important;color:#161a21!important;border-color:#f3f4f7!important;\n border-radius:11px!important;box-shadow:inset 0 1px #fff,0 8px 25px #0004!important;\n}\n.fx-topup-dialog .fx-topup-primary:hover:not(:disabled),\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-next-step.fx-topup-primary:hover:not(:disabled),\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-submit-payment.fx-topup-primary:hover:not(:disabled){\n background:#fff!important;box-shadow:0 9px 26px #0006!important;\n}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-wizard{background:#14171b!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-stage,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-qr-section,\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-slip-form.wallet-payment-slip-section{background:#14171b!important;color:#ecf0f5!important}\n.fx-topup-payment-amount{background:linear-gradient(125deg,#222832,#1b2028)!important;border-color:#414a56!important}\n.fx-topup-payment-amount small{color:#a6b0bc!important}\n.fx-topup-payment-amount strong{color:#f5f7fa!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-qr-stage{background:#fff!important;border-color:#454b56!important;box-shadow:0 7px 30px #0004!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-qr-download.fx-topup-secondary{color:#e3e7ed!important;background:#242a33!important;border-color:#4c5663!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-qr-download:hover{background:#303743!important;border-color:#7d8998!important}\n.fx-topup-qr-caution{color:#b1bac5!important}\n.fx-topup-clock{color:#adb8c6!important}\n.fx-topup-clock b{color:#f3f6fa!important}\n.fx-topup-clock-dot{border-color:#aab5c4!important;border-top-color:#f1f4f8!important}\n.fx-topup-link{color:#acb5c1!important}\n.fx-topup-link:hover{color:#f9fafb!important}\n.fx-topup-slip-intro{color:#a6b0bd!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-slip-form.wallet-payment-slip-section .wallet-upload-zone.fx-topup-upload{\n background:#1b2028!important;border-color:#535e6c!important;color:#e6ebf1!important\n}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-slip-form .wallet-upload-zone:hover{background:#252c36!important;border-color:#a7b2c0!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-graphic{background:#313a45!important;color:#e8edf4!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-zone strong{color:#f4f6f9!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-zone small{color:#9aa8b8!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-browse{background:#333c47!important;color:#f1f3f7!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-upload-zone.has-file{background:#202e2b!important;border-color:#729786!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-payment-verify-footnote{color:#9ca6b3!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-expired-message{color:#ffd9df!important;background:#332329!important;border-color:#71404b!important}\n.fx-topup-backdrop .fx-v89-payment-dialog .wallet-expired-message span{color:#f0abb5!important}\n\n/* V8.9.9: flat, single-focus amount entry; no nested input borders */\n.fx-topup-backdrop .fx-topup-amount-field{display:flex!important;align-items:stretch!important;gap:0!important;overflow:hidden!important;height:58px!important;border-radius:13px!important;border:1px solid #48505c!important;background:#101419!important;box-shadow:inset 0 1px rgba(255,255,255,.02)!important;outline:0!important;padding:0!important}\n.fx-topup-backdrop .fx-topup-amount-field:focus-within{border-color:#e6ebf4!important;box-shadow:0 0 0 3px rgba(213,224,238,.13)!important}\n.fx-topup-backdrop .fx-topup-amount-field .fx-topup-currency{display:flex!important;align-items:center!important;justify-content:center!important;flex:none!important;width:49px!important;height:100%!important;padding:0!important;margin:0!important;border-right:1px solid #343b46!important;background:#191e26!important;color:#b7bfcb!important;font:700 18px/1 system-ui,sans-serif!important}\n.fx-topup-backdrop .fx-topup-amount-field input#wallet-amount-input{display:block!important;flex:1!important;min-width:0!important;width:100%!important;height:100%!important;max-height:none!important;margin:0!important;padding:0 18px!important;border:0!important;border-radius:0!important;outline:none!important;box-shadow:none!important;-webkit-appearance:none!important;appearance:textfield!important;background:transparent!important;color:#f8fafc!important;font-size:21px!important;line-height:1.3!important;font-weight:800!important}\n.fx-topup-backdrop .fx-topup-amount-field input#wallet-amount-input:focus{border:0!important;outline:0!important;box-shadow:none!important}\n.fx-topup-backdrop .fx-topup-amount-field input#wallet-amount-input::-webkit-inner-spin-button,.fx-topup-backdrop .fx-topup-amount-field input#wallet-amount-input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}\n";
function ensureWalletTopupStyles(){
 if(document.getElementById('fix-store-topup-v897-inline'))return;
 const style=document.createElement('style');
 style.id='fix-store-topup-v897-inline';
 style.textContent=FIX_STORE_TOPUP_FALLBACK_CSS;
 document.head.appendChild(style);
}
function refreshWalletAmountDialog(){
 const modal=$('#wallet-amount-modal');if(!modal)return;
 const balanceText=modal.querySelector('.fx-topup-balance strong');if(balanceText)balanceText.textContent=creditText();
 const amount=$('#wallet-amount-input'),submit=$('#wallet-amount-create-button'),status=$('#wallet-amount-status');
 const n=Number(amount?.value);
 const valid=Number.isInteger(n)&&n>=10&&n<=5000;
 modal.querySelectorAll('[data-topup-preset]').forEach(btn=>{const selected=Number(btn.dataset.topupPreset)===n;btn.classList.toggle('selected',selected);btn.setAttribute('aria-pressed',String(selected))});
 const ready=state.walletConfig?.configured===true;
 if(submit){submit.disabled=!valid||!ready||state.busy;submit.innerHTML=valid?`${ico('bag')} สร้าง QR เติมเงิน ${n.toLocaleString('th-TH')} บาท ${ico('arrow')}`:`${ico('bag')} เลือกยอดเงิน 10–5,000 บาท`;}
 if(status){status.hidden=ready;status.querySelector('span').textContent=walletQrStatusText()}
}
function openWalletAmountModal(){
 ensureWalletTopupStyles();
 if(!state.user){go('login');return}
 closeWalletAmountModal();
 if($('#wallet-modal'))closeWalletModal();
 const amount=(Number.isInteger(state.walletAmount)&&state.walletAmount>=10&&state.walletAmount<=5000)?state.walletAmount:100;
 document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop fx-topup-backdrop" id="wallet-amount-modal">
   <section class="modal fx-topup-dialog fx-topup-amount-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-amount-heading">
    <header class="fx-topup-header"><h2 id="wallet-amount-heading">เติมเงินผ่านการสแกน QR</h2><button class="fx-topup-close" type="button" data-action="wallet-amount-close" aria-label="ปิดหน้าต่าง">×</button></header>
    <div class="fx-topup-content">
     
     <div class="fx-topup-balance"><span class="fx-topup-balance-icon">${ico('bag')}</span><div><small>ยอดคงเหลือปัจจุบัน</small><strong>${creditText()}</strong></div></div>
     <form id="wallet-intent-form" class="fx-topup-amount-form">
      <label for="wallet-amount-input">จำนวนเงินที่ต้องการเติม</label>
      <div class="fx-topup-amount-field"><span class="fx-topup-currency" aria-hidden="true">฿</span><input id="wallet-amount-input" type="number" name="amount" inputmode="numeric" min="10" max="5000" step="1" value="${amount}" aria-label="จำนวนเงินที่ต้องการเติมเป็นบาท" required autocomplete="off"></div>
      <p class="fx-topup-hint">ขั้นต่ำ 10 บาท · สูงสุด 5,000 บาท · โปรดโอนให้ตรงกับยอดที่แสดง</p>
      <div class="fx-topup-preset-heading">เลือกจำนวนด่วน</div>
      <div class="fx-topup-preset-list">${[50,100,200,500,1000].map(n=>`<button type="button" data-action="wallet-amount-preset" data-topup-preset="${n}" aria-pressed="${amount===n}">${n.toLocaleString('th-TH')}</button>`).join('')}</div>
      <div class="fx-topup-info">${ico('check')} หลังจากกดเติมเงิน ระบบจะสร้าง QR PromptPay ให้สแกนชำระทันที</div>
      <div class="fx-topup-status" id="wallet-amount-status" role="status" hidden><span></span><button type="button" data-action="wallet-retry-qr">ตรวจสอบอีกครั้ง</button></div>
      <button id="wallet-amount-create-button" class="fx-topup-primary" type="submit">${ico('bag')} สร้าง QR เติมเงิน ${amount.toLocaleString('th-TH')} บาท ${ico('arrow')}</button>
     </form>
    </div>
   </section>
 </div>`);
 refreshWalletAmountDialog();
 syncWalletToastPlacement();
 
 $('#wallet-amount-modal .fx-topup-close')?.focus({preventScroll:true});
 if(state.walletConfig?.configured!==true)void loadWallet(true);
}
function startWalletCountdown(intent){
 stopWalletCountdown();
 const serverNow=Date.parse(intent?.serverTime||''),expire=Date.parse(intent?.expiresAt||'');
 // A server-calculated remaining duration avoids errors from the device clock timezone/skew.
 const remaining=Number.isFinite(serverNow)&&Number.isFinite(expire)?Math.max(0,expire-serverNow):Math.max(0,Math.floor(Number(intent?.expiresMinutes)||5)*60000);
 walletDeadlineMs=Date.now()+remaining;
 updateWalletCountdown();
 if(remaining>0)walletCountdownHandle=setInterval(updateWalletCountdown,1000);
}
function setWalletModalStep(step=1){
 const modal=$('#wallet-modal');
 if(!modal)return;
 const normalized=step===2?2:1;
 modal.dataset.walletStep=String(normalized);
 modal.querySelectorAll('[data-wallet-step-chip]').forEach(chip=>{
  const active=Number(chip.dataset.walletStepChip)===normalized;
  chip.classList.toggle('current',active);
  chip.setAttribute('aria-current',active?'step':'false');
 });
 modal.querySelectorAll('[data-wallet-step-panel]').forEach(panel=>{
  const active=Number(panel.dataset.walletStepPanel)===normalized;
  panel.hidden=!active;
  panel.classList.toggle('is-active',active);
 });
 const title=$('#wallet-payment-heading');
 if(title)title.textContent=normalized===1?'เติมเงินผ่านการสแกน QR':'แนบสลิปยืนยันการโอน';
 if(normalized===2){
  
  $('#wallet-slip-input')?.focus({preventScroll:true});
 }else{
  
  modal.querySelector('[data-action="wallet-download-qr"]')?.focus({preventScroll:true});
 }
}
function openWalletModal(intent){
 ensureWalletTopupStyles();
 if(!intent)return;
 stopWalletCountdown();$('#wallet-modal')?.remove();
 const amount=(num(intent.amountSatang)/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
 document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop wallet-payment-backdrop fx-v89-payment-backdrop fx-topup-backdrop" id="wallet-modal" data-wallet-step="1">
  <section class="modal wallet-modal wallet-payment-dialog fx-v89-payment-dialog fx-topup-dialog fx-topup-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-payment-heading">
   <header class="wallet-payment-title fx-topup-header"><div class="wallet-payment-title-group"><h2 id="wallet-payment-heading">เติมเงินผ่านการสแกน QR</h2></div><button type="button" data-action="wallet-close" class="wallet-payment-close fx-topup-close" aria-label="ปิดหน้าชำระเงิน">×</button></header>
   <div class="wallet-payment-wizard">
    <section class="wallet-payment-stage wallet-payment-qr-section is-active" data-wallet-step-panel="1" aria-label="สแกน QR ชำระเงิน">
     <div class="fx-topup-payment-amount"><small>จำนวนที่ต้องจ่าย</small><strong>${amount} บาท</strong></div>
     <div class="fx-topup-qr-wrap"><div class="wallet-payment-qr-stage"><div class="wallet-payment-qr-paper"><img id="wallet-promptpay-qr" src="${safe(intent.qrDataUrl)}" alt="QR สำหรับโอนเงินจำนวน ${amount} บาท ผ่าน PromptPay" width="246" height="246"></div></div></div>
     <button type="button" class="wallet-qr-download fx-topup-secondary" data-action="wallet-download-qr">${ico('arrow')} ดาวน์โหลด QR Code</button>
     <p class="fx-topup-qr-caution">โปรดตรวจสอบชื่อผู้รับเงินและจำนวนเงินในแอปธนาคารก่อนโอน</p>
     <div class="fx-topup-clock"><span class="fx-topup-clock-dot"></span>QR ใช้ได้อีก <b id="wallet-countdown" role="timer" aria-live="off">05:00</b> นาที</div>
     <div class="fx-topup-bottom-actions"><button type="button" class="fx-topup-primary wallet-next-step" data-action="wallet-next-step">${ico('bag')} โอนแล้ว แนบสลิป ${ico('arrow')}</button><button type="button" class="fx-topup-link" data-action="wallet-close">ยกเลิกรายการ</button></div>
     <div class="wallet-expired-message" role="status"><strong>QR หมดอายุแล้ว</strong><span>หากยังไม่ได้โอนให้สร้าง QR ใหม่ หากโอนแล้วโปรดติดต่อแอดมินก่อนทำรายการใหม่</span><button type="button" class="fx-topup-primary" data-action="wallet-new-qr">สร้าง QR ใหม่</button></div>
    </section>
    <form id="wallet-slip-form" class="wallet-slip-form wallet-payment-stage wallet-payment-slip-section" data-wallet-step-panel="2" hidden>
     <div class="fx-topup-payment-amount fx-topup-receipt-amount"><small>จำนวนที่โอน</small><strong>${amount} บาท</strong></div>
     <p class="fx-topup-slip-intro">โอนเงินเรียบร้อยแล้วใช่ไหม? แนบภาพสลิปที่บันทึกจากแอปธนาคารเพื่อยืนยันรายการ</p>
     <label class="wallet-upload-zone fx-topup-upload" for="wallet-slip-input"><span class="wallet-upload-graphic">${ico('bag')}</span><strong id="wallet-upload-filename">กดเพื่อแนบสลิปการโอนเงิน</strong><small id="wallet-upload-help">ไฟล์ JPG, PNG, WEBP · ไม่เกิน 4 MB</small><img id="wallet-slip-preview" class="fx-v89-slip-preview" alt="ตัวอย่างภาพสลิปที่เลือก" hidden><span class="wallet-upload-browse">${ico('plus')} เลือกไฟล์สลิป</span></label>
     <input class="wallet-file-native" type="file" id="wallet-slip-input" name="slip" accept="image/jpeg,image/png,image/webp" required aria-describedby="wallet-upload-help">
     <div class="fx-topup-clock"><span class="fx-topup-clock-dot"></span>เวลาทำรายการคงเหลือ <b id="wallet-countdown-step2">05:00</b> นาที</div>
     <div class="fx-topup-bottom-actions"><button type="submit" class="fx-topup-primary wallet-submit-payment">${ico('check')} ตรวจสอบสลิปและเติมเครดิต ${ico('arrow')}</button><button type="button" class="fx-topup-link" data-action="wallet-prev-step">← กลับไปดู QR</button></div>
     <p class="wallet-payment-verify-footnote">ระบบเพิ่มเครดิตเมื่อ SlipOK ตรวจสอบการโอนสำเร็จเท่านั้น</p>
     <div class="wallet-expired-message" role="status"><strong>รายการหมดอายุแล้ว</strong><span>หากโอนเงินไปแล้วโปรดติดต่อแอดมินพร้อมหลักฐาน ก่อนสร้างรายการใหม่</span><button type="button" class="fx-topup-primary" data-action="wallet-new-qr">สร้าง QR ใหม่</button></div>
    </form>
   </div>
  </section>
 </div>`);
 setWalletModalStep(1);
 syncWalletToastPlacement();
 startWalletCountdown(intent);
 
}
function downloadWalletQr(){
 if(walletTimeLeftMs()<=0)return toast('QR หมดอายุแล้ว กรุณาสร้างรายการใหม่','error');
 const qr=String(state.walletIntent?.qrDataUrl||'');
 if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr))return toast('ไม่พบ QR ที่พร้อมบันทึก กรุณาสร้าง QR ใหม่','error');
 try{
  const raw=atob(qr.slice(qr.indexOf(',')+1)),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
  const linkEl=document.createElement('a');linkEl.href=url;
  linkEl.download='FIX_STORE_PromptPay_'+(num(state.walletIntent.amountSatang)/100).toFixed(2).replace('.','_')+'.png';
  document.body.append(linkEl);linkEl.click();linkEl.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  toast('ส่งคำขอบันทึก QR แล้ว • บน Safari หากเปิดภาพ ให้แตะค้างที่ภาพเพื่อบันทึก');
 }catch(e){console.error('download QR',e);toast('บันทึก QR ไม่สำเร็จ กรุณาลองใหม่','error')}
}
function updateWalletSlipFile(input){
 const file=input.files?.[0],label=$('#wallet-upload-filename'),hint=$('#wallet-upload-help'),zone=$('.wallet-upload-zone'),preview=$('#wallet-slip-preview');
 if(!label||!zone||!hint)return;
 if(walletSlipPreviewUrl){URL.revokeObjectURL(walletSlipPreviewUrl);walletSlipPreviewUrl=null;}
 if(preview){preview.hidden=true;preview.removeAttribute('src');}
 if(!file){zone.classList.remove('has-file');label.textContent='เลือกภาพสลิปเพื่อยืนยัน';hint.textContent='JPG, PNG หรือ WEBP · ไม่เกิน 4 MB';return;}
 const allowed=['image/jpeg','image/png','image/webp'];
 if(!allowed.includes(file.type)){input.value='';zone.classList.remove('has-file');label.textContent='ประเภทไฟล์ไม่รองรับ';hint.textContent='โปรดใช้ JPG, PNG หรือ WEBP';return toast('รองรับเฉพาะไฟล์ภาพ JPG, PNG หรือ WEBP','error');}
 if(file.size>4*1024*1024){input.value='';zone.classList.remove('has-file');label.textContent='ไฟล์ใหญ่เกิน 4 MB';hint.textContent='โปรดย่อไฟล์ภาพแล้วลองใหม่';return toast('สลิปต้องไม่เกิน 4 MB','error');}
 label.textContent=file.name.slice(0,75);hint.textContent='ขนาด '+(file.size/1024/1024).toFixed(2)+' MB · พร้อมตรวจสอบ';zone.classList.add('has-file');
 if(preview){walletSlipPreviewUrl=URL.createObjectURL(file);preview.src=walletSlipPreviewUrl;preview.hidden=false;}
}
async function verifyWalletSlip(form){if(state.busy)return;if(walletTimeLeftMs()<=0)return toast('QR หมดอายุแล้ว กรุณาสร้างรายการใหม่','error');const file=form.querySelector('input[name=slip]')?.files?.[0];if(!file)return toast('กรุณาแนบสลิป','error');if(file.size>4*1024*1024)return toast('สลิปต้องไม่เกิน 4 MB','error');state.busy=true;const btn=form.querySelector('button[type=submit]');busyButton(btn,true,'กำลังตรวจสลิป...');try{const fd=new FormData();fd.set('intentId',state.walletIntent?.intentId||'');fd.set('slip',file);const result=await walletApi('/api/deposits/verify',{method:'POST',body:fd});closeWalletModal();await loadWallet(false);toast('เติมเครดิตสำเร็จ +฿'+(num(result.amountSatang)/100).toLocaleString('th-TH'));render(true)}catch(e){toast('ตรวจสลิปไม่ผ่าน: '+e.message,'error')}finally{state.busy=false;busyButton(btn,false)}}
async function redeemTopupCode(form){if(state.busy)return;const code=String(new FormData(form).get('code')||'').trim().toUpperCase();if(!/^FXS-(?:[A-HJ-NP-Z2-9]{4}-){3}[A-HJ-NP-Z2-9]{4}$/.test(code))return toast('รูปแบบโค้ดไม่ถูกต้อง ตัวอย่าง FXS-XXXX-XXXX-XXXX-XXXX','error');state.busy=true;const btn=form.querySelector('button[type="submit"]');busyButton(btn,true,'กำลังตรวจสอบโค้ด...');try{const result=await walletApi('/api/wallet/redeem',{method:'POST',body:JSON.stringify({code})});await loadWallet(false);toast('ใช้โค้ดสำเร็จ เพิ่มเครดิต ฿'+(num(result.amountSatang)/100).toLocaleString('th-TH'));render(true)}catch(e){toast('ใช้โค้ดไม่สำเร็จ: '+e.message,'error')}finally{state.busy=false;busyButton(btn,false)}}
async function createAdminTopupCodes(form){if(!state.admin||state.busy)return;const vals=new FormData(form);const amount=Number(vals.get('amount')),quantity=Number(vals.get('quantity')),maxUses=Number(vals.get('maxUses')),expiresValue=Number(vals.get('expiresValue')),expiresUnit=String(vals.get('expiresUnit')||'days');if(!Number.isInteger(amount)||amount<10||amount>5000||!Number.isInteger(quantity)||quantity<1||quantity>10||!Number.isInteger(maxUses)||maxUses<1||maxUses>500||!Number.isInteger(expiresValue)||expiresValue<1||expiresValue>(expiresUnit==='days'?365:8760)||!['hours','days'].includes(expiresUnit)||amount*quantity*maxUses>1000000)return toast('ตรวจสอบมูลค่า จำนวนโค้ด จำนวนคนที่ใช้ได้ และเวลาหมดอายุ (มูลค่ารวมไม่เกิน 1,000,000 บาท)','error');const durationText=expiresValue+(expiresUnit==='days'?' วัน':' ชั่วโมง');if(!(await askConfirm(`สร้าง ${quantity} โค้ด · โค้ดละ ฿${amount.toLocaleString('th-TH')} · สูงสุด ${maxUses} คน/โค้ด · หมดอายุใน ${durationText}`,{title:'ยืนยันสร้างโค้ดเติมเครดิต',confirmLabel:'สร้างโค้ด',detail:'สมาชิกหนึ่งบัญชีใช้โค้ดแต่ละชุดได้หนึ่งครั้ง ระบบจะเพิ่มเครดิตตามจริง'})))return;state.busy=true;const btn=form.querySelector('button[type="submit"]');busyButton(btn,true,'กำลังสร้างโค้ด...');try{const r=await walletApi('/api/admin/topup-codes',{method:'POST',body:JSON.stringify({amount,quantity,maxUses,expiresValue,expiresUnit})});showIssuedCodes(r.codes||[],'฿'+num(amount).toLocaleString('th-TH')+' · '+maxUses+' คน/โค้ด · '+durationText,'โค้ดเติมเครดิตใหม่');void loadCodeHistory('topup');toast('สร้างโค้ดสำเร็จ')}catch(e){toast(e.message,'error')}finally{state.busy=false;busyButton(btn,false)}}
function showIssuedCodes(codes,valueLabel,title='โค้ดใหม่'){const desc=String(valueLabel||'');$('#issued-codes-modal')?.remove();document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="issued-codes-modal"><section class="glass modal" role="dialog" aria-modal="true" aria-label="${safe(title)}"><div class="modal-title"><h2>${safe(title)}</h2><button type="button" data-action="codes-close" aria-label="ปิด">×</button></div><p class="muted">มูลค่า / เงื่อนไขหลัก: ${safe(desc)} · คัดลอกได้ตอนนี้ หรือคัดลอกจากประวัติเมื่อโค้ดยังไม่หมดอายุและยังมีสิทธิ์เหลือ</p><div class="issued-code-list">${codes.map(code=>`<div class="issued-code"><code>${safe(code)}</code><button type="button" data-action="copy-issued-code" data-value="${safe(code)}">คัดลอก</button></div>`).join('')}</div><button class="btn btn-ghost" type="button" data-action="codes-close">ปิดหน้าต่าง</button></section></div>`)}
async function applyDiscountCode(form){if(state.busy)return;const code=String(new FormData(form).get('code')||'').trim().toUpperCase();if(!code)return toast('กรุณากรอกโค้ดส่วนลด','error');state.busy=true;const btn=form.querySelector('button[type=submit]');busyButton(btn,true,'กำลังตรวจสอบ...');try{const result=await walletApi('/api/discounts/preview',{method:'POST',body:JSON.stringify({code})});state.discountCode=code;state.discountPreview={...result,valid:true};toast('ใช้โค้ดส่วนลดสำเร็จ ลด '+bahtSatang(result.discountSatang));render(true)}catch(e){state.discountPreview=null;toast('โค้ดส่วนลดใช้ไม่ได้: '+e.message,'error')}finally{state.busy=false;busyButton(btn,false)}}
function clearDiscountCode(){state.discountCode='';state.discountPreview=null;render(true)}
async function createAdminDiscountCodes(form){if(!state.admin||state.busy)return;const vals=new FormData(form);const kind=String(vals.get('kind')||'fixed');const value=Number(vals.get('value')),quantity=Number(vals.get('quantity')),minSpend=Number(vals.get('minSpend')||0),maxDiscount=Number(vals.get('maxDiscount')||0),expiresDays=Number(vals.get('expiresDays')||30);if(!['fixed','percent'].includes(kind))return toast('ชนิดส่วนลดไม่ถูกต้อง','error');if(!Number.isInteger(quantity)||quantity<1||quantity>20)return toast('สร้างได้ครั้งละ 1–20 โค้ด','error');if(kind==='fixed'&&(!Number.isFinite(value)||value<1||value>5000))return toast('ส่วนลดแบบจำนวนเงินต้องอยู่ระหว่าง 1–5,000 บาท','error');if(kind==='percent'&&(!Number.isFinite(value)||value<1||value>90))return toast('ส่วนลดแบบเปอร์เซ็นต์ต้องอยู่ระหว่าง 1–90%','error');if(!(await askConfirm('สร้างโค้ดส่วนลดจำนวน '+quantity+' โค้ด ตามเงื่อนไขที่กรอกไว้',{title:'ยืนยันสร้างโค้ดส่วนลด',confirmLabel:'สร้างโค้ด'})))return;state.busy=true;const btn=form.querySelector('button[type=submit]');busyButton(btn,true,'กำลังสร้างโค้ด...');try{const r=await walletApi('/api/admin/discount-codes',{method:'POST',body:JSON.stringify({kind,value,quantity,minSpend,maxDiscount,expiresDays})});showIssuedCodes(r.codes||[],kind==='percent'?percentText(value):'฿'+num(value).toLocaleString('th-TH'),'โค้ดส่วนลดใหม่');void loadCodeHistory('discount');toast('สร้างโค้ดส่วนลดสำเร็จ')}catch(e){toast(e.message,'error')}finally{state.busy=false;busyButton(btn,false)}}
async function checkoutWallet(){if(!state.user)return go('login');if(state.busy)return;const applied=state.discountPreview?.valid&&state.discountCode?state.discountCode:'';state.busy=true;const btn=$('[data-action="wallet-checkout"]');busyButton(btn,true,'กำลังชำระด้วยเครดิต...');try{const result=await walletApi('/api/wallet/checkout',{method:'POST',body:JSON.stringify({discountCode:applied})});state.discountCode='';state.discountPreview=null;await Promise.allSettled([loadWallet(false),loadCart(),loadOrders()]);toast('ชำระด้วยเครดิตสำเร็จ · ออเดอร์ '+result.orderId);go('orders')}catch(e){toast('ซื้อด้วยเครดิตไม่สำเร็จ: '+e.message,'error')}finally{state.busy=false;if(btn?.isConnected)busyButton(btn,false)}}

function renderAccount(){if(!state.user)return guard('กรุณาเข้าสู่ระบบ','เข้าสู่ระบบเพื่อดูข้อมูลบัญชี','login');const n=state.orders.length;const completed=state.orders.filter(o=>o.status==='completed').length;const pending=state.orders.filter(o=>['pending','processing'].includes(o.status)).length;const recent=state.orders.slice(0,3);return `<div class="page-in account-dashboard"><div class="account-page-top"><div><span class="eyebrow">FIX STORE / MY ACCOUNT</span><h1>บัญชีของฉัน</h1><p>จัดการข้อมูลสมาชิก เครดิต คำสั่งซื้อ และบริการของคุณในหน้าเดียว</p></div><a class="btn btn-ghost btn-small" href="${link('shop')}">${ico('arrow')} เลือกซื้อสินค้า</a></div>
 <section class="account-hero"><div class="account-profile"><div class="account-avatar">${safe(state.user.username[0].toUpperCase())}</div><div><span class="account-profile-caption">WELCOME BACK</span><h2>${safe(state.user.username)}</h2><span class="account-role">${state.admin?'ADMINISTRATOR':'FIX STORE MEMBER'}</span></div></div><div class="account-wallet-preview"><small>เครดิตคงเหลือ</small><strong>${creditText()}</strong><a href="${link('wallet')}">เติมเครดิต ${ico('arrow')}</a></div></section>
 <div class="account-stats"><article><span>${ico('box')}</span><p>คำสั่งซื้อของฉัน</p><strong>${n}</strong><small>รายการที่ระบบแสดง</small></article><article><span>${ico('clock')}</span><p>กำลังดำเนินการ</p><strong>${pending}</strong><small>รอยืนยัน / จัดส่ง</small></article><article><span>${ico('check')}</span><p>จัดส่งสำเร็จ</p><strong>${completed}</strong><small>จากรายการของคุณ</small></article></div>
 <div class="account-bottom-grid"><section class="account-dashboard-panel"><div class="account-panel-heading"><div><span class="eyebrow">QUICK ACCESS</span><h3>เมนูลัดของคุณ</h3></div></div><div class="account-shortcuts"><a href="${link('wallet')}"><span>${ico('bag')}</span><div><strong>เติมเครดิต</strong><small>QR พร้อมเพย์ / โค้ดเติมเครดิต</small></div>${ico('arrow')}</a><a href="${link('orders')}"><span>${ico('box')}</span><div><strong>ประวัติการซื้อ</strong><small>ดูรหัสสินค้าที่ได้รับและแจ้งเคลม</small></div>${ico('arrow')}</a><a href="${link('cart')}"><span>${ico('bag')}</span><div><strong>ตะกร้าสินค้า</strong><small>ตรวจรายการก่อนชำระด้วยเครดิต</small></div>${ico('arrow')}</a><a href="${link('contact')}"><span>${ico('user')}</span><div><strong>ติดต่อแอดมิน & ช่วยเหลือ</strong><small>สอบถามหรือดูคำถามที่พบบ่อย</small></div>${ico('arrow')}</a>${state.admin?`<a href="${link('admin')}"><span>${ico('settings')}</span><div><strong>ระบบหลังร้าน</strong><small>จัดการสินค้า สต็อก และคำสั่งซื้อ</small></div>${ico('arrow')}</a>`:''}</div></section><section class="account-dashboard-panel"><div class="account-panel-heading"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>คำสั่งซื้อล่าสุด</h3></div><a href="${link('orders')}">ดูทั้งหมด ${ico('arrow')}</a></div>${recent.length?recent.map(o=>`<a class="account-order-row" href="${link('orders')}"><span class="account-order-icon">${ico('box')}</span><div><strong>${safe((o.items||[]).map(i=>i.name).join(', ').slice(0,48)||'คำสั่งซื้อ')}</strong><small>${safe(dateText(o))}</small></div><b>${safe(ST[o.status]||o.status||'รอตรวจสอบ')}</b></a>`).join(''):'<div class="account-no-orders">ยังไม่มีคำสั่งซื้อ<br><small>เลือกสินค้าที่ต้องการเพื่อเริ่มต้นใช้งาน</small></div>'}<div class="account-logout"><button data-action="logout" type="button">${ico('logout')} ออกจากระบบ</button></div></section></div></div>`}

function renderCart(){if(!state.user)return guard('เข้าสู่ระบบเพื่อดูตะกร้า','สินค้าในตะกร้าจะจัดเก็บบน Firebase ของบัญชีคุณเท่านั้น');const rows=state.cart.map(c=>({c,p:state.products.find(p=>p.id===c.id&&p.active!==false)})).filter(x=>x.p),total=rows.reduce((s,{p,c})=>s+num(p.price)*num(c.quantity),0),discount=state.discountPreview?.valid?num(state.discountPreview.discountSatang):0,finalTotal=Math.max(0,total*100-discount)/100;const discountBox=`<div class="cart-promo ${state.discountDrawer?'is-open':''} ${state.discountPreview?.valid?'has-coupon':''}"><button type="button" class="cart-promo-trigger" data-action="toggle-discount-box" title="${state.discountDrawer?'ปิดช่องกรอกโค้ดส่วนลด':'กรอกโค้ดส่วนลด'}" aria-controls="cart-promo-panel" aria-expanded="${state.discountDrawer}" aria-label="${state.discountDrawer?'ปิดช่องกรอกโค้ดส่วนลด':'กรอกโค้ดส่วนลด'}"><span class="cart-promo-icon" aria-hidden="true">${ico('ticket')}</span><span class="cart-promo-title">${state.discountPreview?.valid?'ใช้โค้ดส่วนลดแล้ว':'มีโค้ดส่วนลด?'}</span><span class="cart-promo-caret" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span></button><div id="cart-promo-panel" class="cart-promo-panel" ${state.discountDrawer?'':'hidden'}><form id="discount-form" class="cart-promo-form"><label class="cart-promo-label" for="cart-discount-input">กรอกโค้ดส่วนลดของคุณ</label><div class="cart-promo-fields"><input class="input" id="cart-discount-input" type="text" name="code" value="${safe(state.discountCode||'')}" placeholder="FXD-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32" required aria-label="โค้ดส่วนลด"><button class="cart-promo-apply" type="submit">ใช้โค้ด ${ico('arrow')}</button></div>${state.discountPreview?.valid?`<button class="cart-promo-clear" type="button" data-action="clear-discount">ล้างโค้ดที่ใช้</button>`:''}</form>${state.discountPreview?.valid?`<div class="cart-promo-applied" role="status">${ico('check')} <span>ส่วนลด ${bahtSatang(discount)} จากโค้ด ${safe(state.discountCode)}</span></div>`:''}</div></div>`;return `<div class="page-in cart-page-upgraded"><div class="section-head"><div><span class="eyebrow">YOUR SELECTION</span><h1 class="page-title">ตะกร้าสินค้า</h1><p>ตรวจสอบรายการ ชำระด้วยเครดิต หรือใช้โค้ดส่วนลดได้จากกล่องสรุปด้านขวา</p></div></div><div class="cart-layout"><div class="cart-lines">${rows.length?rows.map(({p,c})=>`<div class="cart-line">${art(p,'cart-thumbnail')}<div class="cart-line-info"><a href="${link('product','id='+encodeURIComponent(p.id))}"><h3>${safe(p.name)}</h3></a><span class="cart-line-category">${safe(categoryName(p.category))}</span><div class="cart-quantity-row"><span class="cart-quantity-label">จำนวน</span><div class="qty cart-qty-controls" aria-label="ปรับจำนวนสินค้า ${safe(p.name)}"><button type="button" data-action="qty" data-id="${safe(p.id)}" data-delta="-1" aria-label="ลดจำนวน ${safe(p.name)}">−</button><b>${num(c.quantity)}</b><button type="button" data-action="qty" data-id="${safe(p.id)}" data-delta="1" aria-label="เพิ่มจำนวน ${safe(p.name)}">+</button></div></div></div><div class="cart-line-end"><strong>${price(num(p.price)*num(c.quantity))}</strong><button type="button" class="trash-button" data-action="remove" data-id="${safe(p.id)}">นำออก</button></div></div>`).join(''):empty('ตะกร้ายังว่าง','เพิ่มสินค้าเพื่อเริ่มต้นสั่งซื้อ')}</div><aside class="glass summary premium-summary"><div class="summary-head"><h3>สรุปรายการ</h3><span>${rows.reduce((s,r)=>s+num(r.c.quantity),0)} ชิ้น</span></div><div class="summary-row"><span>จำนวนสินค้า</span><span>${rows.reduce((s,r)=>s+num(r.c.quantity),0)} รายการ</span></div><div class="summary-row"><span>ยอดก่อนส่วนลด</span><span>${price(total)}</span></div>${discount?`<div class="summary-row discount"><span>ส่วนลด</span><span>- ${bahtSatang(discount)}</span></div>`:''}<div class="summary-row total"><span>${discount?'ยอดสุทธิ (ชำระเครดิต)':'ยอดรวม'}</span><span>${price(finalTotal)}</span></div>${discountBox}<button class="btn btn-primary wallet-checkout wallet-checkout-only" ${!rows.length?'disabled':''} type="button" data-action="wallet-checkout" aria-label="ชำระด้วยเครดิต">${ico('bag')} ชำระด้วยเครดิต ${ico('arrow')}</button><a class="section-link" href="${link('wallet')}">เติมเครดิตเข้ากระเป๋า</a><small>ชำระด้วยเครดิตผ่าน Backend เท่านั้น · ระบบตรวจเครดิต สต็อก และโค้ดส่วนลดก่อนยืนยันคำสั่งซื้อ</small></aside></div></div>`}
const date=t=>{try{return t?.toDate?.().toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'})||'ล่าสุด'}catch{return 'ล่าสุด'}};
function orderCard(o,admin=false){
 const items=Array.isArray(o.items)?o.items:[];
 const sum=items.reduce((n,r)=>n+num(r.price)*num(r.quantity),0),delivered=Array.isArray(o.deliveredItems)?o.deliveredItems:[];
 const hasDelivery=delivered.some(it=>it.codes?.length);
 const totalQty=items.reduce((n,r)=>n+num(r.quantity),0);
 const title=safe(items.map(i=>i.name).join(', ')||'คำสั่งซื้อ');
 const meta=`#${safe(o.id.slice(0,16).toUpperCase())} · ${admin?`สมาชิก ${safe(o.username)} · `:''}${date(o.createdAt)}`;
 const itemChips=items.map(it=>`<div class="order-item-chip"><strong>${safe(it.name)}</strong><span>${num(it.quantity)} ชิ้น · ${safe(DELIVERY_MODES[it.deliveryMode]||'รับสินค้า')}</span></div>`).join('');
 const actions=!admin
  ? `<button type="button" class="mini-btn" data-action="copy-order" data-id="${safe(o.id)}">คัดลอกเลขออเดอร์</button><button type="button" class="mini-btn primary-mini" data-action="view-order" data-id="${safe(o.id)}">${ico('eye')} ดูข้อมูล${hasDelivery?' / รับรหัส':''}</button>${o.status==='completed'?`<button type="button" class="mini-btn claim-mini" data-action="claim-order" data-id="${safe(o.id)}">แจ้งปัญหา / เคลม</button>`:''}`
  : o.status==='pending'
   ? `<button type="button" class="mini-btn primary-mini" data-action="approve-order" data-id="${safe(o.id)}">ตรวจชำระเงินแล้ว · จัดส่ง</button><button type="button" class="mini-btn" data-action="cancel-order" data-id="${safe(o.id)}">ยกเลิก</button>`
   : o.status==='processing'
    ? `<button type="button" class="mini-btn primary-mini" data-action="manual-delivery" data-id="${safe(o.id)}">ส่งรายการที่รอยืนยัน</button>`
    : `<button type="button" class="mini-btn" data-action="view-order" data-id="${safe(o.id)}">ดูข้อมูลจัดส่ง</button>`;
 return `<article class="glass ${admin?'admin-order-card':'order-card'} enhanced-order premium-order-card"><div class="order-card-head"><div class="order-brand-block"><span class="order-brand">FIX STORE</span><small>${meta}</small></div><span class="status ${safe(o.status)} premium-status">${safe(ST[o.status]||o.status||'-')}</span></div><div class="order-card-main"><div class="order-card-title-row"><div><h3>${title}</h3><p>${items.length} รายการ · จำนวนรวม ${totalQty} ชิ้น</p></div></div><div class="order-item-chip-list">${itemChips}</div></div><div class="order-card-footer"><div class="order-total-box"><span>ยอดรายการ</span><strong>${price(sum)}</strong></div><div class="order-actions premium-order-actions">${actions}</div></div></article>`;
}
function orderHistoryPaidBaht(o){
 // A wallet purchase may include a discount. Prefer the actual amount the backend charged.
 const paid=o?.paidSatang;
 if(paid!==undefined&&paid!==null&&Number.isSafeInteger(Number(paid))&&Number(paid)>=0){
  return Number(paid)/100;
 }
 return (Array.isArray(o?.items)?o.items:[]).reduce((n,item)=>n+num(item.price)*num(item.quantity),0);
}
const CLAIM_STATUS_TEXT={pending:'รอเคลม',reviewing:'กำลังตรวจสอบเคลม',resolved:'เคลมสำเร็จ',refunded:'คืนเครดิตสำเร็จ',rejected:'เคลมไม่ผ่าน'};
function ownProductClaim(orderId,productId){
 const uid=state.user?.uid;
 return uid?state.claims.find(c=>c.userId===uid&&c.orderId===orderId&&c.productId===productId):null;
}
function claimBadge(c){return c?`<span class="claim-state-badge ${safe(c.status||'pending')}">${safe(CLAIM_STATUS_TEXT[c.status]||'รอเคลม')}</span>`:'';}
function renderOrders(){
 if(!state.user)return guard('กรุณาเข้าสู่ระบบ','เข้าสู่ระบบเพื่อดูคำสั่งซื้อของคุณ');
 const orders=Array.isArray(state.orders)?state.orders:[];
 const done=orders.filter(o=>o.status==='completed');
 const waiting=orders.filter(o=>o.status==='pending'||o.status==='processing');
 const tab=['all','complete','waiting'].includes(state.ordersTab)?state.ordersTab:'all';
 const rows=tab==='complete'?done:tab==='waiting'?waiting:orders;
 const rowsHtml=rows.map(o=>{
  const items=Array.isArray(o.items)?o.items:[];
  const totalQty=items.reduce((n,r)=>n+num(r.quantity),0);
  const title=safe(items.map(i=>i.name).join(', ')||'คำสั่งซื้อ');
  const total=orderHistoryPaidBaht(o);
  const shortId=safe(String(o.id||'').slice(0,16).toUpperCase());
  const dateLabel=date(o.createdAt);
  const claimed=items.map(it=>({it,claim:ownProductClaim(o.id,it.productId)})).filter(x=>x.claim);
  const claimLine=(items.length>1?claimed:[]).map(x=>`<span class="history-product-claim">${safe(x.it.name||'สินค้า')} ${claimBadge(x.claim)}</span>`).join('');
  const currentClaim=claimed.find(x=>x.claim.status==='pending'||x.claim.status==='reviewing')||claimed[0];
  const statusHtml=items.length===1&&currentClaim?claimBadge(currentClaim.claim):`<span class="history-status-chip ${safe(o.status||'pending')}">${safe(ST[o.status]||o.status||'-')}</span>`;
  const canClaim=o.status==='completed'&&items.some(it=>!ownProductClaim(o.id,it.productId));
  return `<tr><td data-label="สินค้า"><div class="history-product-cell"><strong>${title}</strong><small>#${shortId}</small>${claimLine?`<div class="history-product-claims">${claimLine}</div>`:''}</div></td><td data-label="จำนวน"><span class="history-qty-badge">${totalQty}</span></td><td data-label="ยอดชำระ"><span class="history-price">${total.toLocaleString('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2})}</span></td><td data-label="สถานะ">${statusHtml}</td><td data-label="วัน - เวลา"><span class="history-date">${safe(dateLabel)}</span></td><td data-label="การทำรายการ"><div class="history-actions"><button type="button" class="history-btn history-btn-view" data-action="view-order" data-id="${safe(o.id)}">${ico('eye')} ข้อมูล</button>${canClaim?`<button type="button" class="history-btn history-btn-claim" data-action="claim-order" data-id="${safe(o.id)}">แจ้งปัญหา</button>`:''}</div></td></tr>`;
 }).join('');
 const helpTitle=tab==='waiting'?'รายการที่กำลังดำเนินการ':tab==='complete'?'คำสั่งซื้อที่สำเร็จแล้ว':'คำสั่งซื้อของคุณ';
 const helpText=tab==='waiting'?'ติดตามสถานะรายการที่รอตรวจสอบหรือรอจัดส่ง':tab==='complete'?'ดูข้อมูลสินค้าที่ได้รับ หรือแจ้งปัญหาการใช้งาน':'ดูรายละเอียด สถานะ และข้อมูลสินค้าของแต่ละคำสั่งซื้อ';
 return `<div class="page-in order-history-clean"><div class="orders-title clean-orders-title"><span class="eyebrow">FIX STORE / PURCHASE HISTORY</span><h1 class="page-title">ประวัติการซื้อสินค้า</h1><p>ดูข้อมูลสินค้า ติดตามสถานะ และแจ้งปัญหาได้จากหน้านี้</p></div><div class="orders-tabs clean-orders-tabs"><button type="button" class="${tab==='all'?'active':''}" data-action="orders-tab" data-tab="all" aria-pressed="${tab==='all'}">คำสั่งซื้อ <span>${orders.length}</span></button><button type="button" class="${tab==='complete'?'active':''}" data-action="orders-tab" data-tab="complete" aria-pressed="${tab==='complete'}">สำเร็จแล้ว <span>${done.length}</span></button><button type="button" class="${tab==='waiting'?'active':''}" data-action="orders-tab" data-tab="waiting" aria-pressed="${tab==='waiting'}">รอดำเนินการ <span>${waiting.length}</span></button></div><div class="history-intro-card"><div class="history-intro-icon">${ico('bag')}</div><div><strong>${helpTitle}</strong><p>${helpText}</p></div></div><div class="orders-toolbar clean-orders-toolbar"><span>แสดง ${rows.length} จาก ${orders.length} คำสั่งซื้อ</span></div><div id="orders-results" aria-live="polite">${rows.length?`<div class="orders-table-shell"><table class="orders-data-table"><thead><tr><th scope="col">ชื่อสินค้า</th><th scope="col">จำนวน</th><th scope="col">ยอดชำระ</th><th scope="col">สถานะ</th><th scope="col">วัน - เวลา</th><th scope="col">การทำรายการ</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`:`<div class="history-empty-state"><strong>${tab==='waiting'?'ไม่มีรายการที่กำลังดำเนินการ':tab==='complete'?'ยังไม่มีคำสั่งซื้อที่สำเร็จ':'ยังไม่มีคำสั่งซื้อ'}</strong><p>${tab==='all'?'เลือกซื้อสินค้าได้ที่หน้าสินค้าทั้งหมด':'คุณสามารถดูรายการอื่นได้ที่แท็บคำสั่งซื้อ'}</p>${tab==='all'?`<a class="btn btn-ghost btn-small" href="${link('shop')}">เลือกซื้อสินค้า</a>`:''}</div>`}</div></div>`;
}

function supportChannelCards(){
 const support=https(state.settings.supportLink);
 const discord=https(state.settings.discordUrl);
 const line=https(state.settings.lineUrl);
 const cards=[];
 if(support){
  const isFacebook=/facebook|fb\.com|m\.facebook/i.test(support);
  cards.push({name:isFacebook?'Facebook':'ติดต่อแอดมิน',desc:isFacebook?'ติดต่อร้านผ่าน Facebook':'ติดต่อร้านผ่านช่องทางที่ผู้ดูแลกำหนดไว้',href:support,icon:isFacebook?'facebook':'chat'});
 }
 if(discord)cards.push({name:'Discord',desc:'พูดคุยกับทีมงานผ่าน Discord',href:discord,icon:'discord'});
 if(!cards.length&&line)cards.push({name:'LINE',desc:'ติดต่อร้านผ่าน LINE',href:line,icon:'line'});
 return cards;
}
function renderHelp(){
 const faqs=[
  {q:'วิธีสั่งซื้อสินค้าในร้านทำยังไง?',a:`<ol><li>สมัครสมาชิกหรือเข้าสู่ระบบ</li><li>เลือกสินค้าแล้วกดเพิ่มลงตะกร้า</li><li>ตรวจสอบรายการในตะกร้าและกดสั่งซื้อ</li><li>ชำระเงินผ่านหน้าเติมเงินหรือช่องทางที่ร้านกำหนด</li><li>หลังชำระสำเร็จ ให้ติดตามสถานะที่ <a href="${link('orders')}">ประวัติการซื้อ</a></li></ol>`},
  {q:'วิธีเติมเงินทำยังไง?',a:`เข้าไปที่หน้า <a href="${link('wallet')}">เติมเงิน</a> แล้วเลือกวิธีเติมเครดิตที่ร้านเปิดใช้งานอยู่ จากนั้นทำตามขั้นตอนบนหน้าจอ เช่น สแกน QR หรือกรอกโค้ดเติมเครดิต`},
  {q:'เครดิตคืออะไร ใช้ซื้ออะไรได้บ้าง?',a:'เครดิตคือยอดเงินภายในบัญชี FIX STORE สามารถใช้ชำระค่าสินค้าและบริการในร้านได้ตามที่ระบบรองรับ โดยยอดเครดิตคงเหลือจะแสดงบนบัญชีของคุณ'},
  {q:'หลังซื้อแล้วจะได้รับสินค้าเมื่อไหร่?',a:'หากสินค้าเป็นแบบรับทันทีและมีสต็อก ระบบจะแสดงข้อมูลให้ในประวัติการซื้อทันที แต่ถ้าเป็นรายการที่ต้องรอตรวจสอบหรือให้แอดมินจัดส่ง จะขึ้นสถานะรอดำเนินการก่อน'},
  {q:'สินค้ามีปัญหา แจ้งเคลมยังไง?',a:`เข้าไปที่ <a href="${link('orders')}">ประวัติการซื้อ</a> แล้วเปิดคำสั่งซื้อรายการนั้น จากนั้นใช้ปุ่มแจ้งปัญหา / เคลม พร้อมแนบรายละเอียดให้ครบเพื่อให้แอดมินตรวจสอบได้เร็วขึ้น`},
  {q:'ดูประวัติการซื้อได้ที่ไหน?',a:`สามารถดูได้ที่หน้า <a href="${link('orders')}">ประวัติการซื้อ</a> หลังเข้าสู่ระบบ โดยระบบจะแสดงสถานะสินค้า รายละเอียด และรายการที่ได้รับทั้งหมด`},
  {q:'ติดต่อแอดมินได้อย่างไร?',a:`กดไปที่หน้า <a href="${link('contact-admin')}">ติดต่อแอดมิน</a> แล้วเลือกช่องทางที่ร้านเปิดไว้ เช่น Facebook หรือ Discord`}
 ];
 return `<div class="page-in support-page">
  <nav class="breadcrumb" aria-label="ตำแหน่งหน้าเว็บ"><a href="${link('home')}">หน้าแรก</a><span>/</span><a href="${link('contact')}">ติดต่อแอดมิน & ช่วยเหลือ</a><span>/</span><span>ช่วยเหลือ</span></nav>
  <section class="support-simple-hero"><span class="eyebrow">FIX STORE / HELP CENTER</span><h1 class="page-title">ช่วยเหลือ</h1><p>คำถามที่พบบ่อยและวิธีใช้งานเว็บไซต์</p></section>
  <section class="support-faq-grid" aria-label="คำถามที่พบบ่อย">${faqs.map(item=>`<details class="support-faq-item" name="fixstore-help-faq"><summary>${safe(item.q)}<span class="support-faq-plus" aria-hidden="true">+</span></summary><div class="support-faq-answer">${item.a}</div></details>`).join('')}</section>
 </div>`;
}
function renderContactAdmin(){
 const cards=supportChannelCards();
 const iconMap={
  facebook:'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.6 1.6-1.6H16V4.9c-.3 0-.9-.1-1.8-.1-3 0-4.7 1.8-4.7 5V11H7v3h2.5v7h4Z"/></svg>',
  discord:'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.2 5.8A15.2 15.2 0 0 0 14.4 4l-.2.5-.4 1A11.7 11.7 0 0 0 12 5.3c-.6 0-1.2 0-1.8.2l-.3-1L9.6 4A15 15 0 0 0 5.8 5.8C3.4 9.3 2.9 12.7 3 16c1.6 1.2 3.2 1.9 4.8 2.3l1.2-1.9a9 9 0 0 1-1.9-.9l.5-.4a12.3 12.3 0 0 0 8.8 0l.5.4c-.6.4-1.2.7-1.9.9l1.2 1.9c1.6-.4 3.2-1.1 4.8-2.3.1-3.8-.8-7.2-3-10.2ZM9.8 13.8c-.8 0-1.4-.8-1.4-1.7 0-1 .6-1.7 1.4-1.7.8 0 1.4.8 1.4 1.7 0 1-.6 1.7-1.4 1.7Zm4.4 0c-.8 0-1.4-.8-1.4-1.7 0-1 .6-1.7 1.4-1.7.8 0 1.4.8 1.4 1.7 0 1-.6 1.7-1.4 1.7Z"/></svg>',
  chat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8.5 8.4 9 9 0 0 1-3.5-.7L3 21l1.9-4.7a8.4 8.4 0 1 1 15.1-4.8Z"/></svg>',
  line:'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C6.5 3 2 6.7 2 11.3c0 4 3.4 7.4 8 8l-.7 2.5c-.1.4.3.8.7.5l3-2.1c5.1-.4 9-4 9-8.9C22 6.7 17.5 3 12 3Zm-4 9.4H6.8V8.5H8v3.9Zm2.6 0H9.4V8.5h1.2v3.9Zm4.3 0h-1l-1.9-2.5v2.5h-1.1V8.5H12l1.8 2.4V8.5h1.1v3.9Zm3.1 0h-2.8V8.5H18v1h-1.7v.5h1.5v1h-1.5v.5H18v1Z"/></svg>'
 };
 const empty=`<div class="support-empty"><strong>ยังไม่มีช่องทางติดต่อที่เปิดใช้งาน</strong><p>ร้านยังไม่ได้ตั้งค่าลิงก์สำหรับติดต่อแอดมิน${state.admin?' คุณสามารถเพิ่มได้จากหน้าตั้งค่าร้าน':''}</p>${state.admin?`<a class="support-text-link" href="${link('admin-settings')}">ไปตั้งค่าช่องทาง ${ico('arrow')}</a>`:''}</div>`;
 return `<div class="page-in support-page">
  <nav class="breadcrumb" aria-label="ตำแหน่งหน้าเว็บ"><a href="${link('home')}">หน้าแรก</a><span>/</span><a href="${link('contact')}">ติดต่อแอดมิน & ช่วยเหลือ</a><span>/</span><span>ติดต่อแอดมิน</span></nav>
  <section class="support-simple-hero"><span class="eyebrow">FIX STORE / CONTACT ADMIN</span><h1 class="page-title">ติดต่อแอดมิน</h1><p>เลือกช่องทางติดต่อแอดมิน</p></section>
  <section class="support-contact-grid">${cards.length?cards.map(card=>`<a class="support-contact-card" href="${safe(card.href)}" target="_blank" rel="noopener noreferrer"><span class="support-contact-icon ${safe(card.icon)}">${iconMap[card.icon]||iconMap.chat}</span><strong>${safe(card.name)}</strong><small>${safe(card.desc)}</small></a>`).join(''):empty}</section>
 </div>`;
}
function renderContact(){
 const count=supportChannelCards().length;
 return `<div class="page-in support-page">
  <section class="support-hub-header"><h1 class="support-hub-title">ติดต่อแอดมิน & ช่วยเหลือ</h1><p class="support-hub-subtitle">เลือกสิ่งที่ต้องการ</p></section>
  <section class="support-hub-grid" aria-label="ตัวเลือกติดต่อและช่วยเหลือ">
   <a class="support-hub-card" href="${link('contact-admin')}"><span class="support-hub-icon">${ico('user')}</span><strong>ติดต่อแอดมิน</strong><small>${count?`มี ${count} ช่องทางติดต่อ`:'Facebook และ Discord'}</small></a>
   <a class="support-hub-card" href="${link('help')}"><span class="support-hub-icon">${ico('check')}</span><strong>ช่วยเหลือ</strong><small>คำถามที่พบบ่อยและวิธีใช้งาน</small></a>
  </section>
 </div>`;
}
// ADMIN: each view lives inside the same index.html and shares the same Auth session.
const admPages={admin:['ภาพรวม','box'],'admin-products':['จัดการสินค้า','edit'],'admin-categories':['จัดการหมวดหมู่','box'],'admin-announcements':['ประกาศร้านค้า','clock'],'admin-stock':['เติมสต็อก','plus'],'admin-orders':['คำสั่งซื้อ','bag'],'admin-claims':['รอเคลม','clock'],'admin-members':['จัดการสมาชิก','users'],'admin-topup-codes':['สร้างโค้ดเติมเครดิต','ticket'],'admin-discount-codes':['สร้างโค้ดส่วนลด','ticket'],'admin-api':['ตรวจสอบ API','settings'],'admin-settings':['ตั้งค่าร้าน','settings']};
function adminFrame(key,body){if(!state.user)return guard('เข้าสู่ระบบแอดมิน','กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลก่อน');if(!state.admin)return `<div class="page-in admin-denied glass"><span class="eyebrow">ADMIN ACCESS / CHECK</span><h1>บัญชียังไม่มีสิทธิ์จัดการร้าน</h1><p>ระบบยืนยันตัวตนแล้ว แต่ยังไม่พบ Custom Claim <code>admin: true</code> ของบัญชีนี้ การเพิ่มสินค้าและหมวดหมู่จึงถูก Firestore Rules ปฏิเสธ</p><p>บัญชี: <strong>${safe(state.user.username)}</strong> · UID: <code>${safe(state.user.uid)}</code></p><p>ตรวจสอบ UID นี้กับ Firebase Authentication แล้วเพิ่มสิทธิ์ด้วย Firebase Admin SDK จากคอมพิวเตอร์ผู้ดูแล</p><div class="admin-denied-actions"><button class="btn btn-primary" data-action="refresh-admin">ตรวจสอบสิทธิ์อีกครั้ง ${ico('arrow')}</button><a class="btn btn-ghost" href="${link('account')}">กลับบัญชีของฉัน</a></div></div>`;return `<div class="page-in admin-layout"><aside class="glass admin-nav"><small>ADMIN / CONTROL CENTER</small>${Object.entries(admPages).map(([p,[title,ic]])=>`<a href="${link(p)}" class="${p===key?'active':''}">${ico(ic)}${title}${p==='admin-claims'?` <span class="admin-pill-count">${visibleAdminClaims().filter(c=>['pending','reviewing'].includes(c.status)).length}</span>`:''}</a>`).join('')}</aside><div class="admin-content"><div class="section-head"><div><span class="eyebrow">FIX STORE / ADMIN</span><h1 class="page-title">${admPages[key][0]}</h1></div><a class="btn btn-ghost btn-small" href="${link('home')}">กลับหน้าร้าน ${ico('arrow')}</a></div>${body}</div></div>`}
function renderDashboard(){const stats=[['สินค้าทั้งหมด',state.products.length,'รายการ'],['เปิดจำหน่าย',activeProducts().length,'รายการ'],['หมวดหมู่',state.categories.length,'หมวดหมู่'],['สต็อกพร้อมขาย',state.products.reduce((a,p)=>a+num(p.stockCount),0),'โค้ด'],['ออเดอร์รอตรวจ',state.adminOrders.filter(o=>o.status==='pending').length,'รายการ'],['รอเคลม',visibleAdminClaims().filter(c=>['pending','reviewing'].includes(c.status)).length,'เคส']];return adminFrame('admin',`<div class="stat-grid">${stats.map(s=>`<div class="glass stat"><small>${s[0]}</small><strong>${s[1].toLocaleString('th-TH')}</strong><span>${s[2]}</span></div>`).join('')}</div><section class="glass admin-panel"><div class="admin-toolbar"><strong>คำสั่งซื้อล่าสุด</strong><a class="section-link" href="${link('admin-orders')}">ดูทั้งหมด ${ico('arrow')}</a></div><div class="admin-order-list">${state.adminOrders.length?state.adminOrders.slice(0,4).map(o=>orderCard(o,true)).join(''):'<p class="muted">ยังไม่มีคำสั่งซื้อ</p>'}</div></section>`)}
function renderAdminProducts(){const selectable=state.categories.filter(c=>c.active!==false);return adminFrame('admin-products',`<section class="glass admin-panel"><div class="admin-toolbar"><strong>สินค้า ${state.products.length} รายการ</strong><div class="admin-toolbar-actions"><a class="btn btn-ghost btn-small" href="${link('admin-categories')}">จัดการหมวดหมู่</a><button class="btn btn-primary btn-small" data-action="new-product" ${selectable.length?'':'disabled title="ต้องสร้างหมวดหมู่ก่อน"'}>${ico('plus')} เพิ่มสินค้าใหม่</button></div></div>${selectable.length?`<p class="admin-help-text">ก่อนเพิ่มสินค้าให้เลือกหมวดหมู่ที่สร้างไว้แล้ว · หากบันทึกไม่สำเร็จ ให้ตรวจสอบสิทธิ์ Admin และ Firestore Rules ที่เผยแพร่ล่าสุด</p>`:`<div class="category-required"><div><strong>ขั้นตอนที่ 1 — สร้างหมวดหมู่ก่อน</strong><p>ร้านยังไม่มีหมวดหมู่ที่เปิดใช้งาน จึงยังไม่สามารถเพิ่มสินค้าได้ สร้างหมวดหมู่แล้วกลับมาเพิ่มสินค้าในขั้นตอนที่ 2</p></div><a class="btn btn-primary btn-small" href="${link('admin-categories')}">${ico('plus')} สร้างหมวดหมู่</a></div>`}<div class="table-wrap"><table class="data-table"><thead><tr><th>สินค้า</th><th>หมวดหมู่</th><th>ราคา</th><th>สต็อก</th><th>วิธีส่ง</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${state.products.map(p=>`<tr><td><strong>${safe(p.name)}</strong></td><td>${safe(categoryName(p.category))}</td><td>${price(p.price)}</td><td>${num(p.stockCount)}</td><td>${safe(DELIVERY_MODES[deliveryMode(p)])}</td><td>${p.active===false?'ปิดขาย':'เปิดขาย'}</td><td><div class="admin-edit"><button class="mini-btn" data-action="edit-product" data-id="${safe(p.id)}">แก้ไข</button><button class="mini-btn" data-action="delete-product" data-id="${safe(p.id)}">ลบ</button></div></td></tr>`).join('')||'<tr><td colspan="7" class="muted">ยังไม่มีสินค้า</td></tr>'}</tbody></table></div></section>`)}
function editorModal(id){const p=state.products.find(x=>x.id===id)||{};const choices=state.categories.filter(c=>c.active!==false||c.id===p.category);const hasValidCategory=!!choices.length;return `<div class="modal-backdrop" id="editor-modal"><div class="glass modal" role="dialog" aria-modal="true" aria-label="จัดการสินค้า"><div class="modal-title"><div><span class="eyebrow">PRODUCT / EDITOR</span><h2>${id?'แก้ไขสินค้า':'เพิ่มสินค้าใหม่'}</h2></div><button type="button" data-action="close-modal" aria-label="ปิด">×</button></div><form id="product-form" class="admin-form"><input type="hidden" name="id" value="${safe(id||'')}"><label>ชื่อสินค้า<input class="input" name="name" maxlength="100" placeholder="เช่น เกมออนไลน์ 30 วัน" required value="${safe(p.name||'')}"></label><label class="category-selector-label">หมวดหมู่สินค้า <span class="required-mark">* จำเป็นต้องเลือก</span><select class="input" name="category" required><option value="" disabled ${!choices.some(c=>c.id===p.category)?'selected':''}>— เลือกหมวดหมู่สินค้าที่สร้างแล้ว —</option>${choices.map(c=>`<option value="${safe(c.id)}" ${p.category===c.id?'selected':''}>${safe(c.name)}${c.active===false?' (ปิดการแสดงผล)':''}</option>`).join('')}</select><small class="muted">ต้องสร้างหมวดหมู่ในหลังร้านก่อน ไม่สามารถพิมพ์หมวดหมู่ขึ้นมาเองในฟอร์มสินค้าได้</small></label><div class="form-row"><label>ราคา (บาท)<input class="input" name="price" type="number" min="0" max="1000000" step=".01" required value="${p.price??''}" placeholder="99"></label><label>สัญลักษณ์สินค้า (กรณีไม่มีรูป)<input class="input" name="art" maxlength="5" value="${safe(p.art||'✦')}"></label></div><div class="form-row"><label>Badge<input class="input" name="badge" maxlength="18" value="${safe(p.badge||'')}"></label><label>URL รูปปกสินค้า HTTPS (แนะนำ 1040 × 1040 px)<input class="input" name="imageUrl" value="${safe(p.imageUrl||'')}" placeholder="https://.../cover-1040x1040.webp"></label></div><details class="product-gallery-editor" ${Array.isArray(p.galleryImages)&&p.galleryImages.length?'open':''}><summary>รูปสินค้าเพิ่มเติม <span>สูงสุด 5 รูป (ไม่บังคับ)</span></summary><p class="product-gallery-hint">ใส่ลิงก์ HTTPS ของรูปแต่ละรูป เช่นเดียวกับรูปปก หากเว้นว่างทั้งหมด หน้าเว็บจะแสดงเฉพาะรูปปกโดยไม่มีรูปย่อ</p><div class="product-gallery-editor-grid">${Array.from({length:5},(_,i)=>`<label>รูปเพิ่มเติม ${i+1}<input class="input" name="galleryImage${i+1}" type="url" maxlength="500" inputmode="url" spellcheck="false" value="${safe(Array.isArray(p.galleryImages)?p.galleryImages[i]||'':'')}" placeholder="https://.../image-${i+1}.webp"></label>`).join('')}</div></details><label>วิธีจัดส่งสินค้า<select class="input" name="deliveryMode" required>${Object.entries(DELIVERY_MODES).map(([key,label])=>`<option value="${key}" ${deliveryMode(p)===key?'selected':''}>${label}</option>`).join('')}</select><small class="muted">สินค้าประเภทรับทันที / สุ่ม / Netflix ต้องมีรหัสในสต็อก ส่วนแบบรอยืนยันสามารถให้แอดมินกรอกข้อมูลภายหลังได้</small></label><label>รายละเอียด<textarea class="input input-area" name="description" maxlength="1500">${safe(p.description||'')}</textarea></label><div class="form-row"><label class="check-line"><input type="checkbox" name="active" ${p.active!==false?'checked':''}> เปิดขาย</label><label class="check-line"><input type="checkbox" name="featured" ${p.featured?'checked':''}> สินค้าแนะนำ</label></div>${hasValidCategory?'':`<div class="category-required"><div><strong>กรุณาสร้างหมวดหมู่ก่อน</strong><p>ยังไม่มีหมวดหมู่ที่เปิดใช้งาน จึงไม่สามารถบันทึกสินค้าได้</p></div><a class="btn btn-primary btn-small" href="${link('admin-categories')}">จัดการหมวดหมู่ ${ico('arrow')}</a></div>`}<p class="form-inline-error" id="product-form-error" hidden role="alert"></p><div class="form-actions"><button class="btn btn-primary" type="submit" ${hasValidCategory?'':'disabled'}>บันทึกสินค้า ${ico('arrow')}</button><button class="btn btn-ghost" type="button" data-action="close-modal">ยกเลิก</button></div></form></div></div>`}
function renderAdminCategories(){const rows=allCategories();return adminFrame('admin-categories',`<section class="glass admin-panel categories-admin"><div class="admin-toolbar"><div><strong>หมวดหมู่สินค้า</strong><p class="muted admin-help-text">แก้ชื่อ รูปภาพ คำอธิบาย และเลือกให้สินค้าอยู่หมวดหมู่ใดได้ในเมนูเพิ่มสินค้า</p></div><div class="admin-toolbar-actions"><button type="button" class="btn btn-ghost btn-small" data-action="seed-categories">เพิ่มหมวดหมู่พื้นฐาน</button><button type="button" class="btn btn-primary btn-small" data-action="new-category">${ico('plus')} สร้างหมวดหมู่</button></div></div><div class="admin-category-grid">${rows.length?rows.map(c=>`<article class="admin-category-card"><div class="admin-category-preview">${categoryCover(c)}</div><div class="admin-category-row"><span><strong>${safe(c.name)}</strong><small>${categoryProductCount(c.id)} สินค้า · ${c.active===false?'ซ่อนจากหน้าร้าน':'แสดงบนหน้าร้าน'}${c.legacy?' · หมวดหมู่เก่า':''}</small></span><div class="admin-edit">${c.legacy?'<span class="muted legacy-badge">นำเข้าหมวดหมู่พื้นฐานเพื่อแก้ไข</span>':`<button class="mini-btn" type="button" data-action="edit-category" data-id="${safe(c.id)}">แก้ไข</button><button class="mini-btn" type="button" data-action="delete-category" data-id="${safe(c.id)}">ลบ</button>`}</div></div></article>`).join(''):'<div class="category-empty">ยังไม่มีหมวดหมู่ กด “สร้างหมวดหมู่” เพื่อเริ่มต้น</div>'}</div></section>`)}
function categoryModal(id){const c=state.categories.find(x=>x.id===id)||{};return `<div class="modal-backdrop" id="editor-modal"><div class="glass modal" role="dialog" aria-modal="true" aria-label="จัดการหมวดหมู่"><div class="modal-title"><div><span class="eyebrow">CATEGORY / EDITOR</span><h2>${id?'แก้ไขหมวดหมู่':'สร้างหมวดหมู่ใหม่'}</h2></div><button data-action="close-modal" type="button" aria-label="ปิด">×</button></div><form id="category-form" class="admin-form"><input type="hidden" name="id" value="${safe(id||'')}"><label>ชื่อหมวดหมู่<input class="input" name="name" maxlength="60" placeholder="เช่น โค้ดเกมออนไลน์" value="${safe(c.name||'')}" required></label><label>คำอธิบายสั้น ๆ<input class="input" name="description" maxlength="110" placeholder="รายละเอียดใต้ป้ายหมวดหมู่" value="${safe(c.description||'')}"></label><label>รูปภาพแบนเนอร์ (ลิงก์ HTTPS เท่านั้น)<input class="input" name="coverUrl" type="url" placeholder="https://example.com/category-cover.webp" value="${safe(c.coverUrl||'')}"></label><div class="form-row"><label>ลำดับการแสดง<input class="input" type="number" min="0" max="999" name="order" value="${Number.isFinite(+c.order)?num(c.order):10}"></label><label class="check-line category-active"><input type="checkbox" name="active" ${c.active!==false?'checked':''}> แสดงหมวดหมู่บนหน้าร้าน</label></div><p class="muted admin-help-text">ถ้ายังไม่มีรูป ระบบจะแสดงพื้นหลังดำ–เงินให้โดยอัตโนมัติ แนะนำรูปภาพแนวนอนสัดส่วนประมาณ 3:1 เช่น 2048 × 682 พิกเซล ระบบแสดงภาพเต็มโดยไม่ตัด</p><p class="form-inline-error" id="category-form-error" hidden role="alert"></p><div class="form-actions"><button class="btn btn-primary" type="submit">${id?'บันทึกการแก้ไข':'สร้างหมวดหมู่'} ${ico('arrow')}</button><button class="btn btn-ghost" type="button" data-action="close-modal">ยกเลิก</button></div></form></div></div>`}
async function saveCategory(form){if(!state.admin)return toast('บัญชีนี้ไม่มีสิทธิ์ Admin','error');const v=new FormData(form),id=String(v.get('id')||''),name=String(v.get('name')||'').trim(),description=String(v.get('description')||'').trim(),coverUrl=String(v.get('coverUrl')||'').trim(),order=Number(v.get('order')||0);const displayError=msg=>{const e=$('#category-form-error');if(e){e.hidden=false;e.textContent=msg}toast(msg,'error')};if(!name||name.length>60)return displayError('กรุณากรอกชื่อหมวดหมู่ (ไม่เกิน 60 ตัวอักษร)');if(!Number.isInteger(order)||order<0||order>999)return displayError('ลำดับการแสดงต้องเป็นจำนวนเต็ม 0–999');if(coverUrl&&!https(coverUrl))return displayError('รูปภาพต้องเป็นลิงก์ HTTPS');if(state.categories.some(c=>c.id!==id&&c.name.toLowerCase()===name.toLowerCase()))return displayError('ชื่อหมวดหมู่นี้ถูกใช้แล้ว');const data={name,description:description.slice(0,110),coverUrl:coverUrl.slice(0,1000),active:v.get('active')==='on',order,updatedAt:now()};const btn=form.querySelector('button[type=submit]');busyButton(btn,true,'กำลังบันทึก...');try{if(id)await state.F.updateDoc(doc('categories',id),data);else await state.F.addDoc(col('categories'),{...data,createdAt:now()});await loadCategories();$('#editor-modal')?.remove();render();toast('บันทึกหมวดหมู่ใน Firebase สำเร็จ')}catch(e){console.error('[FIX STORE] saveCategory',e);displayError('บันทึกหมวดหมู่ไม่สำเร็จ: '+errMsg(e)+(e?.code==='permission-denied'?' (ตรวจสอบ Custom Claim admin และ Rules ของ categories)':''))}finally{busyButton(btn,false)}}
async function deleteCategory(id){const cat=state.categories.find(c=>c.id===id);if(!cat)return;const used=state.products.filter(p=>p.category===id).length;if(used)return toast(`ไม่สามารถลบหมวดหมู่นี้ได้ เพราะมีสินค้า ${used} รายการ กรุณาย้ายหมวดหมู่สินค้าก่อน`,'error');if(!(await askConfirm(`หมวดหมู่ ${cat.name} จะถูกลบออกจากร้าน`,{title:'ยืนยันลบหมวดหมู่',confirmLabel:'ลบหมวดหมู่',danger:true})))return;try{await state.F.deleteDoc(doc('categories',id));await loadCategories();render();toast('ลบหมวดหมู่แล้ว')}catch(e){toast('ลบหมวดหมู่ไม่สำเร็จ: '+errMsg(e),'error')}}
async function seedCategories(){if(!state.admin)return toast('ต้องมีสิทธิ์ Admin','error');const entries=Object.entries(LEGACY_CATS).filter(([id])=>!state.categories.some(c=>c.id===id));if(!entries.length)return toast('มีหมวดหมู่พื้นฐานครบแล้ว');if(!(await askConfirm('สร้างหมวดหมู่พื้นฐาน '+entries.length+' รายการใน Firestore โดยไม่ลบหรือแก้สินค้าเก่า',{title:'สร้างหมวดหมู่พื้นฐาน',confirmLabel:'สร้างหมวดหมู่'})))return;try{const batch=state.F.writeBatch(state.db);entries.forEach(([id,name],idx)=>batch.set(doc('categories',id),{name,description:'สินค้าและบริการเกม',coverUrl:'',active:true,order:(idx+1)*10,createdAt:now(),updatedAt:now()}));await batch.commit();await loadCategories();render();toast('เพิ่มหมวดหมู่พื้นฐานเรียบร้อย')}catch(e){toast('สร้างหมวดหมู่ไม่สำเร็จ: '+errMsg(e),'error')}}
async function refreshAdmin(){if(!state.auth?.currentUser)return toast('กรุณาเข้าสู่ระบบใหม่','error');try{const result=await state.A.getIdTokenResult(state.auth.currentUser,true);state.admin=result.claims.admin===true;setStatus();render();if(state.admin)toast('ยืนยันสิทธิ์ Admin สำเร็จ');else toast('UID นี้ยังไม่ได้รับ Custom Claim admin: true','error')}catch(e){toast('ตรวจสิทธิ์ไม่สำเร็จ: '+errMsg(e),'error')}}
function renderAdminAnnouncements(){const rows=[...state.announcements].sort((a,b)=>num(a.order)-num(b.order));return adminFrame('admin-announcements',`<section class="glass admin-panel"><div class="admin-toolbar"><div><strong>จัดการประกาศ (${rows.length})</strong><p class="muted admin-help-text">จัดการข้อความประกาศวิ่งใต้แบนเนอร์หน้าแรก · เลือกเปิด/ปิด ปรับลำดับ และลิงก์ได้</p></div><button type="button" class="btn btn-primary btn-small" data-action="new-announcement">${ico('plus')} เพิ่มประกาศ</button></div>${state.announcementError?`<p class="form-inline-error">${safe(errMsg(state.announcementError))} — กรุณา Publish firestore.rules เวอร์ชันใหม่นี้</p>`:''}<div class="notice-admin-list">${rows.length?rows.map(n=>`<article class="notice-admin-item"><div class="notice-admin-content"><span class="notice-admin-status ${n.active?'on':''}">${n.active?'เปิดประกาศ':'ปิดประกาศ'}</span><strong>${safe(n.text||'')}</strong><small>ลำดับ ${num(n.order)} · ${safe(n.href||'ไม่มีลิงก์')}</small></div><div class="admin-edit"><button type="button" class="mini-btn" data-action="edit-announcement" data-id="${safe(n.id)}">แก้ไข</button><button type="button" class="mini-btn" data-action="delete-announcement" data-id="${safe(n.id)}">ลบ</button></div></article>`).join(''):'<div class="category-empty">ยังไม่มีประกาศ กด “เพิ่มประกาศ” เพื่อสร้างประกาศแรก</div>'}</div></section>`)}
function announcementModal(id){const n=state.announcements.find(x=>x.id===id)||{};return `<div class="modal-backdrop" id="editor-modal"><div class="glass modal" role="dialog" aria-modal="true" aria-label="จัดการประกาศ"><div class="modal-title"><div><span class="eyebrow">STORE / ANNOUNCEMENT</span><h2>${id?'แก้ไขประกาศ':'สร้างประกาศใหม่'}</h2></div><button data-action="close-modal" type="button" aria-label="ปิด">×</button></div><form id="announcement-form" class="admin-form"><input type="hidden" name="id" value="${safe(id||'')}"><label>ข้อความประกาศ <span class="required-mark">*</span><input class="input" name="text" required minlength="2" maxlength="180" placeholder="เช่น เปิดรับออเดอร์แล้ววันนี้" value="${safe(n.text||'')}"></label><label>ลิงก์เมื่อคลิก (ไม่จำเป็น)<input class="input" name="href" maxlength="500" placeholder="#/shop หรือ https://..." value="${safe(n.href||'')}"></label><div class="form-row"><label>ลำดับการแสดง<input class="input" type="number" name="order" min="0" max="999" step="1" value="${Number.isInteger(n.order)?n.order:10}"></label><label class="check-line category-active"><input type="checkbox" name="active" ${n.active!==false?'checked':''}> เปิดแสดงประกาศ</label></div><p class="muted admin-help-text">แถบใต้แบนเนอร์จะวิ่งวนต่อเนื่อง · หากมีหลายประกาศจะแสดงเรียงต่อกัน · หยุดเลื่อนเมื่อเมาส์ชี้</p><p id="announcement-form-error" class="form-inline-error" hidden role="alert"></p><div class="form-actions"><button class="btn btn-primary" type="submit">บันทึกประกาศ ${ico('arrow')}</button><button class="btn btn-ghost" type="button" data-action="close-modal">ยกเลิก</button></div></form></div></div>`}
async function saveAnnouncement(form){if(!state.admin)return toast('บัญชีนี้ไม่มีสิทธิ์ Admin','error');const v=new FormData(form),id=String(v.get('id')||''),txt=String(v.get('text')||'').trim(),href=String(v.get('href')||'').trim(),order=Number(v.get('order')||0);const fail=msg=>{const out=$('#announcement-form-error');if(out){out.hidden=false;out.textContent=msg}toast(msg,'error')};if(txt.length<2||txt.length>180)return fail('ข้อความประกาศต้องยาว 2–180 ตัวอักษร');if(href&&!noticeUrl(href))return fail('ลิงก์ต้องเป็น HTTPS หรือเส้นทางภายใน เช่น #/shop');if(!Number.isInteger(order)||order<0||order>999)return fail('ลำดับต้องเป็นเลขจำนวนเต็ม 0–999');const btn=form.querySelector('button[type=submit]');busyButton(btn,true,'กำลังบันทึก...');try{const data={text:txt,href,active:v.get('active')==='on',order,updatedAt:now()};if(id)await state.F.updateDoc(doc('announcements',id),data);else await state.F.addDoc(col('announcements'),{...data,createdAt:now()});await loadAnnouncements();$('#editor-modal')?.remove();render();toast('บันทึกประกาศสำเร็จ')}catch(e){console.error('[FIX STORE] announcement save',e);fail('บันทึกประกาศไม่สำเร็จ: '+errMsg(e))}finally{busyButton(btn,false)}}
async function deleteAnnouncement(id){const n=state.announcements.find(x=>x.id===id);if(!n)return;if(!(await askConfirm('ประกาศนี้จะถูกลบออกจากร้านและไม่แสดงอีก',{title:'ยืนยันลบประกาศ',confirmLabel:'ลบประกาศ',danger:true})))return;try{await state.F.deleteDoc(doc('announcements',id));await loadAnnouncements();render();toast('ลบประกาศเรียบร้อย')}catch(e){toast('ลบประกาศไม่สำเร็จ: '+errMsg(e),'error')}}
function renderAdminStock(){return adminFrame('admin-stock',`<div class="glass admin-panel"><form class="admin-form" id="stock-form"><label>เลือกสินค้า<select class="input" id="stock-product" name="product" required>${state.products.map(p=>`<option value="${safe(p.id)}" ${p.id===state.stockProduct?'selected':''}>${safe(p.name)} — ${num(p.stockCount)} โค้ด</option>`).join('')}</select></label><label>รหัสสินค้า (หนึ่งบรรทัด = สินค้า 1 ชิ้น)<textarea class="input input-area" name="codes" rows="7" placeholder="GAME-CODE-001&#10;หรือ Netflix: email|password|profile|pin" required></textarea></label><p class="muted">Netflix: สามารถเติมรูปแบบ email|password|profile|pin หนึ่งชุดต่อบรรทัด · ข้อมูลสต็อกอ่านได้เฉพาะแอดมิน</p><div><button class="btn btn-primary" ${state.products.length?'':'disabled'} type="submit">${ico('plus')} เติมสต็อกลง Firebase</button></div></form><div class="stock-list" id="stock-list">${state.stock.length?state.stock.map(s=>`<div class="stock-row"><code>${safe(s.code)}</code><button class="mini-btn" data-action="delete-stock" data-id="${safe(s.id)}">ลบ</button></div>`).join(''):'<p class="muted">เลือกสินค้าเพื่อดูสต็อก</p>'}</div></div>`)}
function renderAdminOrders(){return adminFrame('admin-orders',`<div class="glass admin-panel alert-guide"> <b>ตรวจการชำระเงินจริงก่อนกดจัดส่ง</b><p>ระบบนี้ไม่มีการตรวจสลิปอัตโนมัติ แอดมินเป็นผู้อนุมัติทุกออเดอร์ เมื่อกดจัดส่ง รหัสจากสต็อกจะถูกลบและเพิ่มในประวัติซื้อด้วย Firestore Transaction</p></div><section class="admin-order-list">${state.adminOrders.length?state.adminOrders.map(o=>orderCard(o,true)).join(''):'<div class="glass admin-panel muted">ยังไม่มีคำสั่งซื้อ</div>'}</section>`)}
function bahtSatang(n){return '฿'+(Number(n||0)/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}
function renderAdminMembers(){const users=state.adminUsers;return adminFrame('admin-members',`<section class="glass admin-panel admin-users-panel"><div class="admin-toolbar"><div><span class="eyebrow">FIREBASE AUTH / WALLET</span><strong>บัญชีผู้ใช้ ${users.length} รายการ</strong><p class="muted">จัดการรหัสผ่านและเครดิตผ่าน Backend เท่านั้น · ทุกการปรับยอดมีประวัติ</p></div><button type="button" class="btn btn-ghost btn-small" data-action="refresh-users">${ico('check')} โหลดสมาชิกใหม่</button></div><div class="admin-users-tools"><label class="admin-user-search">${ico('search')}<input class="input" id="admin-user-search" type="search" placeholder="ค้นหา Username หรือ UID" aria-label="ค้นหาสมาชิก"></label><span class="muted">${state.adminUsersPartial?'แสดง 250 รายการแรกจาก Firebase Auth':'ข้อมูลบัญชีจาก Firebase Auth'}</span></div>${state.adminUsersError?`<div class="admin-error">${safe(state.adminUsersError)}</div>`:''}<div class="table-wrap"><table class="data-table admin-user-table"><thead><tr><th>สมาชิก</th><th>เครดิตคงเหลือ</th><th>สิทธิ์</th><th>จัดการ</th></tr></thead><tbody>${users.map(u=>`<tr data-user-row data-user-uid="${safe(u.uid)}" data-user-filter="${safe((u.username+' '+u.uid).toLowerCase())}"><td><div class="admin-user-identity"><span class="admin-user-avatar">${safe((u.username||'?')[0].toUpperCase())}</span><span><strong>${safe(u.username)}</strong><small title="UID">${safe(u.uid)}</small></span></div></td><td class="admin-credit-cell">${bahtSatang(u.balanceSatang)}</td><td><span class="admin-role-tag ${u.admin?'is-admin':''}">${u.admin?'ADMIN':'MEMBER'}${u.disabled?' · ปิดบัญชี':''}</span></td><td><button type="button" class="btn btn-ghost btn-small" data-action="manage-user" data-id="${safe(u.uid)}">จัดการบัญชี ${ico('arrow')}</button></td></tr>`).join('')||`<tr><td colspan="4" class="muted">${state.adminUsersLoading?'กำลังโหลดสมาชิก...':'ไม่มีข้อมูลสมาชิก กรุณาโหลดใหม่'}</td></tr>`}</tbody></table></div><p class="admin-users-empty muted" id="admin-users-empty" hidden>ไม่พบสมาชิกที่ค้นหา</p></section>`) }
function renderAdminAPI(){const data=state.apiMonitor;const checks=data?.checks||{};const icons={backend:'server',firebaseAuth:'user',firestore:'box',promptpay:'bag',slipok:'check'};const names={backend:'Backend API',firebaseAuth:'Firebase Authentication',firestore:'Cloud Firestore',promptpay:'PromptPay',slipok:'SlipOK'};const labels={online:'ออนไลน์',configured:'ตั้งค่าแล้ว',unconfigured:'ยังไม่ได้ตั้งค่า',checking:'กำลังตรวจสอบ',error:'มีข้อผิดพลาด'};const rows=Object.keys(names).map(k=>{const v=checks[k]||{status:'checking'};return `<div class="api-service"><div class="api-service-icon">${ico(icons[k])}</div><div class="api-service-desc"><strong>${names[k]}</strong><small>${safe(v.message|| (v.latencyMs!=null?'ตอบกลับ '+v.latencyMs+' ms':'สถานะตรวจสอบจาก Backend'))}</small></div><span class="api-service-state ${safe(v.status)}"><i></i>${safe(labels[v.status]||'รอตรวจสอบ')}</span></div>`}).join('');const quota=checks.slipok;return adminFrame('admin-api',`<div class="api-monitor-hero"><div><span class="eyebrow">SYSTEM MONITOR / REAL TIME CHECK</span><h2>สถานะระบบ API</h2><p>ตรวจสอบการเชื่อมต่อจริงจากเซิร์ฟเวอร์ ไม่แสดงค่าโควตาจำลอง</p></div><button type="button" class="btn btn-primary btn-small" data-action="refresh-api">${ico('check')} ตรวจสอบอีกครั้ง</button></div>${state.apiMonitorError?`<div class="admin-error">${safe(state.apiMonitorError)}</div>`:''}<div class="api-stat-cards"><div class="api-stat-card"><small>โควตา SlipOK คงเหลือ</small><strong>${quota?.status==='online'?num(quota.quota).toLocaleString('th-TH'):'—'}</strong><span>ครั้ง · ${quota?.status==='online'?'ข้อมูลล่าสุดจาก SlipOK':'ยังอ่านข้อมูลไม่ได้'}</span></div><div class="api-stat-card"><small>โควตาใช้เกิน</small><strong>${quota?.status==='online'&&quota.overQuota!==null?num(quota.overQuota).toLocaleString('th-TH'):'—'}</strong><span>ครั้ง · ไม่เดาตัวเลขเมื่อ API ผิดพลาด</span></div><div class="api-stat-card"><small>ตรวจสอบล่าสุด</small><strong class="api-checked-time">${data?.checkedAt?safe(new Date(data.checkedAt).toLocaleTimeString('th-TH')):'—'}</strong><span>${data?.checkedAt?safe(new Date(data.checkedAt).toLocaleDateString('th-TH')):'ยังไม่ตรวจสอบ'}</span></div></div><section class="glass admin-panel api-monitor-list"><div class="admin-toolbar"><strong>บริการของ FIX STORE</strong><small>ตรวจเมื่อเปิดหน้าและกดรีเฟรชเท่านั้น</small></div>${rows}</section><p class="muted api-footnote">สถานะพร้อมเพย์แสดงการตั้งค่า QR เท่านั้น ไม่ใช่การยืนยันเงินเข้า · โควตา SlipOK มาจาก <code>/quota</code> ของบัญชีร้าน ไม่ใช่จำนวนสลิปที่ระบบคาดเดา</p>`) }
function historyValueText(item,kind){return kind==='topup'?bahtSatang(item.valueSatang):item.kind==='percent'?percentText(item.percentOff)+' (สูงสุด '+(item.maxDiscountSatang?bahtSatang(item.maxDiscountSatang):'ไม่จำกัด')+')':bahtSatang(item.valueSatang)}
function historyDate(iso){if(!iso)return '—';const d=new Date(iso);return Number.isFinite(d.getTime())?d.toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}):'—'}
function codeHistoryHTML(kind){
 const h=state.codeHistories[kind];
 const items=h.items||[],redeemed=items.filter(x=>x.status==='redeemed'),unused=items.filter(x=>x.status==='active'),expired=items.filter(x=>x.status==='expired');const redeemedUses=items.reduce((sum,x)=>sum+num(x.usedCount),0),totalUsages=items.reduce((sum,x)=>sum+num(x.maxUses),0);
 const batchTotals=new Map();for(const it of items){const key=it.batchId||it.id;const b=batchTotals.get(key)||{count:0,used:0,capacity:0};b.count++;b.used+=num(it.usedCount);b.capacity+=num(it.maxUses)||1;batchTotals.set(key,b)}
 return `<div class="code-history-summary"><div><span>โค้ดที่โหลดมา</span><strong>${items.length.toLocaleString('th-TH')}</strong></div><div><span>มีการใช้แล้ว</span><strong>${redeemedUses.toLocaleString('th-TH')} / ${totalUsages.toLocaleString('th-TH')}</strong></div><div><span>โค้ดยังใช้ได้</span><strong>${unused.length.toLocaleString('th-TH')}</strong></div><div><span>หมดอายุ</span><strong>${expired.length.toLocaleString('th-TH')}</strong></div></div>
 ${h.error?`<p class="code-history-error" role="alert">${safe(h.error)}</p>`:''}
 <div class="code-history-scroll"><table class="code-history-table"><thead><tr><th>รหัสที่สร้าง / คัดลอก</th><th>มูลค่า</th><th>ใช้แล้ว / สูงสุด</th><th>ผู้ใช้ล่าสุด</th><th>สถานะ</th><th>วันที่สร้าง / ใช้ / หมดอายุ</th></tr></thead><tbody>${items.length?items.map(it=>`<tr><td><div class="fx-v89-code-inline"><code title="รหัสที่แสดงบางส่วน">${safe(it.maskedCode)}</code>${it.canCopy?`<button type="button" class="history-copy fx-v89-icon-action" data-action="copy-history-code" data-kind="${kind}" data-id="${safe(it.id)}" title="คัดลอกโค้ด" aria-label="คัดลอกโค้ดที่ยังใช้ได้">${ico('copy')}</button>`:''}</div><small>ชุด ${safe(String(it.batchId||it.id).slice(0,8))} · ใช้ไป ${num(batchTotals.get(it.batchId||it.id)?.used)}/${num(batchTotals.get(it.batchId||it.id)?.capacity)} สิทธิ์</small></td><td><strong>${safe(historyValueText(it,kind))}</strong></td><td><b>${num(it.usedCount)}/${num(it.maxUses)||1}</b><small>เหลือ ${Math.max(0,num(it.remainingUses))} คน</small></td><td>${it.usedByName?`<strong>${safe(it.usedByName)}</strong>`:'<span class="muted">—</span>'}</td><td><span class="code-history-status ${safe(it.status)}">${it.status==='redeemed'?'ใช้แล้ว':it.status==='active'?'พร้อมใช้':it.status==='expired'?'หมดอายุ':'ปิดใช้งาน'}</span></td><td><small>สร้าง: ${safe(historyDate(it.createdAt))}</small><small>ใช้: ${safe(historyDate(it.redeemedAt))}</small><small>หมดอายุ: ${safe(historyDate(it.expiresAt))}</small></td></tr>`).join(''):`<tr><td colspan="6" class="history-empty">${h.loading?'กำลังโหลดประวัติ...':'ยังไม่มีประวัติการสร้างโค้ด'}</td></tr>`}</tbody></table></div>
 ${h.hasMore?`<button class="btn btn-ghost btn-small history-more" type="button" data-action="more-code-history" data-kind="${kind}" ${h.loading?'disabled':''}>โหลดประวัติเพิ่ม ${ico('arrow')}</button>`:''}<p class="code-history-note">${h.hasMore?'แสดงบางรายการจากระบบ · กดโหลดเพิ่มเพื่อดูหน้าถัดไป':'รายการที่แสดงอ้างอิงฐานข้อมูลจริง'} · โค้ดเติมเครดิตหนึ่งชุดกำหนดจำนวนผู้ใช้ได้ แต่แต่ละบัญชีใช้ซ้ำไม่ได้ · ปุ่มคัดลอกแสดงเฉพาะโค้ดรุ่นใหม่ที่ยังมีสิทธิ์และไม่หมดอายุ · โค้ดเก่าเก็บเป็นแฮชจึงกู้ตัวเต็มไม่ได้</p>`;
}
async function copyHistoryCode(kind,id){if(!state.admin||!['topup','discount'].includes(kind)||!/^[a-f0-9]{64}$/.test(id))return toast('ไม่มีสิทธิ์คัดลอกโค้ดนี้','error');try{const result=await walletApi('/api/admin/codes/'+kind+'/'+id+'/plain');await copyText(result.code);toast('คัดลอกโค้ดที่ยังใช้ได้แล้ว')}catch(e){toast('คัดลอกไม่ได้: '+e.message,'error')}}
function codeHistoryPanel(kind){return `<section class="glass admin-panel code-history-panel" data-code-history="${kind}"><div class="code-history-head"><div><span class="eyebrow">CODE AUDIT / ${kind==='topup'?'WALLET':'DISCOUNT'}</span><h3>ประวัติการสร้างและใช้งานโค้ด</h3><p>ตรวจจำนวนโค้ดที่สร้าง โค้ดที่ใช้แล้ว และสมาชิกที่นำไปใช้</p></div><button type="button" class="fx-v89-history-refresh" data-action="refresh-code-history" data-kind="${kind}" title="รีเฟรชประวัติ" aria-label="รีเฟรชประวัติการใช้โค้ด">${ico('clock')} <span>อัปเดตข้อมูล</span></button></div><div class="code-history-content" data-code-history-content="${kind}">${codeHistoryHTML(kind)}</div></section>`}
async function loadCodeHistory(kind,more=false){
 if(!state.admin||!['topup','discount'].includes(kind))return;
 const h=state.codeHistories[kind];if(h.loading)return;
 h.loading=true;h.error=null;
 const path=kind==='topup'?'/api/admin/topup-codes/history':'/api/admin/discount-codes/history';
 try{
  const endpoint=path+(more&&h.nextCursor?'?cursor='+encodeURIComponent(h.nextCursor):'');
  const data=await walletApi(endpoint);
  const fresh=Array.isArray(data.items)?data.items:[];
  h.items=more?[...h.items,...fresh.filter(x=>!h.items.some(old=>old.id===x.id))]:fresh;
  h.hasMore=data.hasMore===true;h.nextCursor=data.nextCursor||null;
 }catch(e){h.error=e.message||'โหลดประวัติไม่สำเร็จ'}finally{h.loading=false;const box=$(`[data-code-history-content="${kind}"]`);if(box)box.innerHTML=codeHistoryHTML(kind)}
}
function renderAdminTopupCodes(){return adminFrame('admin-topup-codes',`<section class="promo-v76-heading"><div><p>สร้างโค้ดเติมเครดิต กำหนดจำนวนคนที่ใช้ได้และระยะเวลาหมดอายุของแต่ละโค้ด</p></div><a class="fx-v89-admin-shortcut" href="${link('admin-discount-codes')}">${ico('ticket')} ไปหน้าโค้ดส่วนลด ${ico('arrow')}</a></section>
<section class="promo-v76-layout"><article class="glass admin-panel promo-v76-form"><div class="promo-v76-card-head"><div class="promo-v76-card-icon">${ico('bag')}</div><div><span>WALLET CODE GENERATOR</span><h3>ตั้งค่าโค้ดเติมเครดิต</h3></div></div><form id="admin-topup-code-form" class="promo-form"><div class="form-row"><label>มูลค่าโค้ด (บาท)<input class="input" type="number" name="amount" min="10" max="5000" step="1" value="100" required></label><label>จำนวนโค้ดที่สร้าง<input class="input" type="number" name="quantity" min="1" max="10" value="1" required></label></div><div class="form-row"><label>จำนวนคนที่ใช้ได้ต่อโค้ด<input class="input" type="number" name="maxUses" min="1" max="500" step="1" value="10" required><small class="muted">หนึ่งบัญชีแลกโค้ดเดียวกันได้หนึ่งครั้ง</small></label><label>หมดอายุภายใน<div class="code-expiry-control"><input class="input" type="number" name="expiresValue" min="1" max="365" step="1" value="7" required><select class="input" name="expiresUnit"><option value="days">วัน</option><option value="hours">ชั่วโมง</option></select></div></label></div><div class="promo-v76-action"><button class="btn btn-primary" type="submit">${ico('plus')} สร้างโค้ดเติมเครดิต ${ico('arrow')}</button></div></form></article>
<aside class="glass promo-v76-aside"><span class="eyebrow">HOW IT WORKS</span><h3>เติมเงินด้วยโค้ด</h3><ol><li>กำหนดมูลค่า จำนวนโค้ด และจำนวนคนสูงสุดต่อโค้ด</li><li>กำหนดระยะเวลาหมดอายุเป็นชั่วโมงหรือวัน</li><li>ลูกค้าหนึ่งบัญชีใช้โค้ดเดียวกันได้เพียงหนึ่งครั้ง</li><li>ระบบเติมเครดิตและนับจำนวนที่ใช้ผ่าน Backend โดยอัตโนมัติ</li></ol><p>คัดลอกรหัสที่ยังใช้ได้จากประวัติได้ รหัสถูกเข้ารหัสไว้ที่ Backend และจะไม่เปิดเผยให้ลูกค้ารายอื่น</p></aside></section>${codeHistoryPanel('topup')}`)}
function renderAdminDiscountCodes(){return adminFrame('admin-discount-codes',`<section class="promo-v76-heading"><div><p>สร้างโปรโมชั่นสำหรับหน้าชำระเงิน โดยเลือกส่วนลดเป็นบาทหรือเปอร์เซ็นต์ พร้อมเงื่อนไขยอดขั้นต่ำ</p></div><a class="fx-v89-admin-shortcut" href="${link('admin-topup-codes')}">${ico('bag')} ไปหน้าโค้ดเติมเครดิต ${ico('arrow')}</a></section>
<section class="promo-v76-layout"><article class="glass admin-panel promo-v76-form"><div class="promo-v76-card-head"><div class="promo-v76-card-icon">${ico('ticket')}</div><div><span>DISCOUNT CODE GENERATOR</span><h3>ตั้งค่าโค้ดส่วนลด</h3></div></div><form id="admin-discount-code-form" class="promo-form"><div class="form-row"><label>รูปแบบส่วนลด<select class="input" name="kind" required><option value="fixed">ลดเป็นบาท</option><option value="percent">ลดเป็นเปอร์เซ็นต์ (%)</option></select></label><label>มูลค่าส่วนลด<input class="input" type="number" name="value" min="1" max="5000" step="1" value="50" required></label></div><div class="form-row"><label>ยอดสั่งซื้อขั้นต่ำ (บาท)<input class="input" type="number" name="minSpend" min="0" max="50000" step="1" value="0"></label><label>ลดสูงสุด (บาท สำหรับ %)<input class="input" type="number" name="maxDiscount" min="0" max="5000" step="1" value="0"></label></div><div class="form-row"><label>อายุโค้ด (วัน)<input class="input" type="number" name="expiresDays" min="1" max="365" value="30"></label><label>จำนวนโค้ด<input class="input" type="number" name="quantity" min="1" max="20" value="1" required></label></div><div class="promo-v76-action"><button class="btn btn-primary" type="submit">${ico('plus')} สร้างโค้ดส่วนลด ${ico('arrow')}</button></div></form></article>
<aside class="glass promo-v76-aside"><span class="eyebrow">DISCOUNT RULES</span><h3>เงื่อนไขโค้ดส่วนลด</h3><div class="promo-v76-rules"><div><b>ลดเป็นบาท</b><small>ตัวอย่าง 50 หมายถึงลด 50 บาท</small></div><div><b>ลดเป็นเปอร์เซ็นต์</b><small>ตัวอย่าง 10 หมายถึงลด 10% ของยอดสั่งซื้อ</small></div><div><b>ยอดขั้นต่ำ</b><small>ตั้ง 0 หากไม่บังคับยอดขั้นต่ำ</small></div><div><b>ลดสูงสุด</b><small>กำหนดเพดานส่วนลดสำหรับโปรโมชั่นแบบ %</small></div></div><p>โค้ดจะตรวจสอบจากยอดและสินค้าใน Firebase อีกครั้งขณะซื้อด้วยเครดิต</p></aside></section>${codeHistoryPanel('discount')}`)}
async function loadAdminUsers(){if(!state.admin)return;state.adminUsersLoading=true;state.adminUsersError=null;try{const r=await walletApi('/api/admin/users');state.adminUsers=Array.isArray(r.users)?r.users:[];state.adminUsersPartial=!!r.partial}catch(e){state.adminUsersError=e.message;state.adminUsers=[]}finally{state.adminUsersLoading=false;if(state.current==='admin-members')render(true)}}
async function loadApiMonitor(){if(!state.admin)return;state.apiMonitorLoading=true;state.apiMonitorError=null;try{state.apiMonitor=await walletApi('/api/admin/system-status')}catch(e){state.apiMonitorError=e.message;state.apiMonitor=null}finally{state.apiMonitorLoading=false;if(state.current==='admin-api')render(true)}}
function financeLedgerLabel(it){const names={purchase:'ซื้อสินค้า',topup:'เติมเงินผ่าน QR',redeem:'เติมด้วยโค้ด',admin_adjust:'ปรับเครดิตโดยแอดมิน'};return names[it.kind]||'ธุรกรรมเครดิต'}
function financeIsIncoming(it){return it.kind==='purchase'?false:it.kind==='admin_adjust'?num(it.amountSatang)>=0:true}
function financeLedgerHTML(){
 const h=userFinancePanel;
 if(h.error)return `<div class="user-finance-error" role="alert">${ico('clock')} ${safe(h.error)} <button type="button" data-action="user-finance-refresh">ลองใหม่</button></div>`;
 const rows=h.items||[];
 const incoming=rows.filter(financeIsIncoming).reduce((n,it)=>n+Math.abs(num(it.amountSatang)),0);
 const outgoing=rows.filter(it=>!financeIsIncoming(it)).reduce((n,it)=>n+Math.abs(num(it.amountSatang)),0);
 return `<div class="user-finance-mini-stats"><div><span>เครดิตเพิ่ม (ในรายการที่โหลด)</span><strong class="positive">+${bahtSatang(incoming)}</strong></div><div><span>เครดิตใช้/หัก (ในรายการที่โหลด)</span><strong class="negative">−${bahtSatang(outgoing)}</strong></div></div>
 <div class="user-finance-ledger">${rows.length?rows.map(it=>{const add=financeIsIncoming(it);const d=it.createdAt?new Date(it.createdAt):null;return `<div class="user-ledger-entry"><span class="user-ledger-sign ${add?'positive':'negative'}">${add?ico('plus'):ico('bag')}</span><div class="user-ledger-detail"><strong>${safe(financeLedgerLabel(it))}</strong><small>${d&&!Number.isNaN(d.getTime())?safe(d.toLocaleString('th-TH')):'ไม่ทราบเวลา'}${it.reason?' · '+safe(it.reason):''}</small>${it.kind==='admin_adjust'&&it.balanceAfterSatang!=null?`<small>คงเหลือหลังรายการ: ${bahtSatang(it.balanceAfterSatang)}</small>`:''}</div><b class="${add?'positive':'negative'}">${add?'+':'−'}${bahtSatang(Math.abs(num(it.amountSatang)))}</b></div>`}).join(''):`<div class="user-ledger-empty">${h.loading?'กำลังโหลดธุรกรรม...':'ยังไม่มีประวัติการเงิน'}</div>`}</div>
 ${h.hasMore?`<button class="user-finance-more" data-action="user-finance-more" type="button" ${h.loading?'disabled':''}>โหลดรายการก่อนหน้า ${ico('arrow')}</button>`:''}<small class="user-finance-foot">แสดง ${rows.length} รายการล่าสุดที่โหลดจาก Firestore · ยอดบวก/ลบด้านบนคำนวณจากรายการที่โหลดเท่านั้น</small>`;
}
function refreshUserFinanceHTML(){const slot=$('#user-finance-history-slot');if(slot)slot.innerHTML=financeLedgerHTML();const bal=$('#user-finance-balance');if(bal&&userFinancePanel.balanceSatang!=null)bal.textContent=bahtSatang(userFinancePanel.balanceSatang)}
async function loadUserFinancialHistory(uid,more=false){
 if(!state.admin||!uid||!$('#user-finance-history-slot')||userFinancePanel.loading)return;
 if(userFinancePanel.uid!==uid){userFinancePanel={uid,items:[],nextCursor:null,hasMore:false,loading:false,error:null,balanceSatang:null}}
 userFinancePanel.loading=true;userFinancePanel.error=null;refreshUserFinanceHTML();
 try{
  const cursor=more&&userFinancePanel.nextCursor?'?cursor='+encodeURIComponent(userFinancePanel.nextCursor):'';
  const result=await walletApi('/api/admin/users/'+encodeURIComponent(uid)+'/finance'+cursor);
  if(!$('#editor-modal [data-user-manager-uid="'+uid+'"]'))return;
  const added=Array.isArray(result.items)?result.items:[];
  userFinancePanel.items=more?[...userFinancePanel.items,...added.filter(x=>!userFinancePanel.items.some(old=>old.id===x.id))]:added;
  userFinancePanel.hasMore=result.hasMore===true;userFinancePanel.nextCursor=result.nextCursor||null;
  userFinancePanel.balanceSatang=num(result.balanceSatang);
  const local=state.adminUsers.find(x=>x.uid===uid);if(local)local.balanceSatang=userFinancePanel.balanceSatang;
 }catch(e){userFinancePanel.error=e.message||'ไม่สามารถโหลดประวัติธุรกรรมได้'}
 finally{userFinancePanel.loading=false;refreshUserFinanceHTML()}
}
function switchUserManagerTab(tab){
 if(!['account','finance'].includes(tab))return;
 const box=$('#user-manager-tabs');if(!box)return;
 $$('[data-user-tab]',box).forEach(b=>{const active=b.dataset.userTab===tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1});
 $$('[data-user-pane]').forEach(p=>{p.hidden=p.dataset.userPane!==tab});
 if(tab==='account'){stopFinanceLive();return}
 const uid=$('[data-user-manager-uid]')?.dataset.userManagerUid;
 if(uid){if(!userFinancePanel.items.length&&!userFinancePanel.loading&&!userFinancePanel.error)void loadUserFinancialHistory(uid);startFinanceLive(uid)}
}
function showUserManager(uid){
 const u=state.adminUsers.find(x=>x.uid===uid);if(!state.admin||!u)return toast('ไม่พบสมาชิก กรุณาโหลดข้อมูลใหม่','error');
 stopFinanceLive();$('#editor-modal')?.remove();userFinancePanel={uid,items:[],nextCursor:null,hasMore:false,loading:false,error:null,balanceSatang:num(u.balanceSatang)};
 const locked=u.admin&&u.uid!==state.user.uid;
 const joined=u.joinedAt?new Date(u.joinedAt):null;
 const joinedText=joined&&!Number.isNaN(joined.getTime())?joined.toLocaleDateString('th-TH'):'—';
 document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop user-control-backdrop" id="editor-modal"><section class="glass modal admin-user-modal user-control-v88" role="dialog" aria-modal="true" aria-labelledby="user-control-title" data-user-manager-uid="${safe(uid)}">
  <header class="user-control-heading"><div class="user-control-avatar">${safe((u.username||'?')[0].toUpperCase())}</div><div class="user-control-heading-main"><span class="eyebrow">USER / CONTROL PANEL</span><h2 id="user-control-title">${safe(u.username)}</h2><p>จัดการบัญชีและธุรกรรมสมาชิก</p></div><button type="button" class="user-control-close" data-action="close-modal" aria-label="ปิดหน้าจัดการสมาชิก">×</button></header>
  <nav class="user-control-tabs" id="user-manager-tabs" role="tablist" aria-label="ส่วนจัดการสมาชิก"><button type="button" role="tab" class="user-control-tab active" data-action="user-panel-tab" data-user-tab="account" aria-controls="user-account-pane" aria-selected="true" tabindex="0">${ico('user')} จัดการผู้ใช้</button><button type="button" role="tab" class="user-control-tab" data-action="user-panel-tab" data-user-tab="finance" aria-controls="user-finance-pane" aria-selected="false" tabindex="-1">${ico('bag')} การเงิน</button></nav>
  <div class="user-control-scroll">
   <section class="user-control-pane" id="user-account-pane" role="tabpanel" data-user-pane="account"><div class="user-control-subhead"><span class="eyebrow">ACCOUNT / PROFILE</span><h3>ข้อมูลบัญชี</h3></div><div class="user-account-info"><div><small>ชื่อผู้ใช้</small><strong>${safe(u.username)}</strong></div><div><small>สิทธิ์</small><strong>${u.admin?'Administrator':'Member'}</strong></div><div><small>สถานะบัญชี</small><strong class="${u.disabled?'negative':'positive'}">${u.disabled?'ปิดใช้งาน':'ใช้งานปกติ'}</strong></div><div><small>วันที่สมัคร</small><strong>${safe(joinedText)}</strong></div></div>
    <div class="user-control-uid"><div><small>FIREBASE USER ID</small><code title="${safe(u.uid)}">${safe(u.uid)}</code></div><button type="button" data-action="copy-user-uid" data-id="${safe(u.uid)}" title="คัดลอก UID" aria-label="คัดลอก UID">${ico('check')} คัดลอก</button></div>
    <div class="user-control-divider"></div><div class="user-control-subhead"><span class="eyebrow">SECURITY / PASSWORD</span><h3>เปลี่ยนรหัสผ่าน</h3><p>${locked?'ไม่อนุญาตให้เปลี่ยนรหัสของแอดมินคนอื่น':'รหัสเดิมจะใช้ไม่ได้ และสมาชิกต้องเข้าสู่ระบบใหม่'}</p></div>
    <form class="admin-form user-control-form" id="admin-reset-password-form"><input type="hidden" name="uid" value="${safe(uid)}"><label>รหัสผ่านใหม่<input class="input" type="password" name="password" autocomplete="new-password" minlength="10" maxlength="128" required placeholder="อย่างน้อย 10 ตัวอักษร" ${locked?'disabled':''}></label><label>ยืนยันรหัสผ่านใหม่<input class="input" type="password" name="confirm" autocomplete="new-password" minlength="10" maxlength="128" required placeholder="กรอกรหัสผ่านอีกครั้ง" ${locked?'disabled':''}></label><label>เหตุผลในการเปลี่ยนรหัส<input class="input" name="reason" minlength="8" maxlength="300" placeholder="เช่น สมาชิกแจ้งขอเปลี่ยนหลังยืนยันตัวตน" required ${locked?'disabled':''}></label><button class="btn btn-primary user-control-submit" type="submit" ${locked?'disabled':''}>ยืนยันเปลี่ยนรหัสผ่าน ${ico('arrow')}</button></form><p class="admin-privacy-note">จัดการรหัสผ่านผ่าน Firebase Admin Authentication เท่านั้น ไม่เก็บรหัสผ่านใน Firestore</p>
   </section>
   <section class="user-control-pane" id="user-finance-pane" role="tabpanel" data-user-pane="finance" hidden><div class="user-finance-balance"><div><span class="eyebrow">WALLET / AVAILABLE BALANCE</span><small>เครดิตคงเหลือ</small><strong id="user-finance-balance">${bahtSatang(u.balanceSatang)}</strong></div><span class="user-finance-balance-icon">${ico('bag')}</span></div>
    <div class="user-control-subhead"><span class="eyebrow">CREDIT / ADJUSTMENT</span><h3>เพิ่มและหักเครดิต</h3><p>การปรับเครดิตตรวจสอบยอดและบันทึกประวัติผ่าน Backend ทุกครั้ง</p></div>
    <form class="admin-form user-control-form" id="admin-credit-form"><input type="hidden" name="uid" value="${safe(uid)}"><div class="form-row"><label>ประเภทการทำรายการ<select class="input" name="direction"><option value="add">+ เพิ่มเครดิต</option><option value="subtract">− หักเครดิต</option></select></label><label>จำนวนเงิน (บาท)<input class="input" type="number" name="amount" min="0.01" max="10000" step="0.01" placeholder="100.00" required></label></div><label>เหตุผลในการปรับยอด<input class="input" name="reason" maxlength="300" minlength="8" placeholder="เช่น คืนเงินจากออเดอร์ #1234" required></label><button class="btn btn-primary user-control-submit" type="submit">ยืนยันปรับเครดิต ${ico('arrow')}</button></form>
    <div class="user-control-divider"></div><div class="user-control-subhead user-history-head"><div><span class="eyebrow">FINANCE / TRANSACTIONS</span><h3>ประวัติการเงิน</h3></div><button type="button" class="user-finance-refresh" data-action="user-finance-refresh">${ico('clock')} รีเฟรช</button></div><div id="user-finance-history-slot" aria-live="polite">${financeLedgerHTML()}</div>
   </section>
  </div>
 </section></div>`);
 $('#user-manager-tabs [data-user-tab="account"]')?.focus({preventScroll:true});
}
async function submitAdminCredit(form){
 if(state.busy)return;
 const v=new FormData(form),uid=String(v.get('uid')||''),amount=Number(v.get('amount')),direction=String(v.get('direction')),reason=String(v.get('reason')||'').trim();
 if(!['add','subtract'].includes(direction)||!Number.isFinite(amount)||amount<=0||amount>10000||Math.abs(Math.round(amount*100)-amount*100)>.001||reason.length<8)return toast('ตรวจสอบประเภท ยอดไม่เกิน 10,000 บาท และเหตุผลอย่างน้อย 8 ตัวอักษร','error');
 const deltaSatang=Math.round(amount*100)*(direction==='subtract'?-1:1);
 if(!(await askConfirm(`${deltaSatang>0?'เพิ่ม':'หัก'}เครดิต ${bahtSatang(Math.abs(deltaSatang))} ให้สมาชิก ${uid}`,{title:'ยืนยันปรับเครดิตสมาชิก',confirmLabel:deltaSatang>0?'เพิ่มเครดิต':'หักเครดิต',danger:deltaSatang<0,detail:'ระบบจะบันทึกยอดก่อน–หลัง เหตุผล และผู้ดำเนินการ'})))return;
 state.busy=true;const btn=form.querySelector('button[type="submit"]');busyButton(btn,true);
 try{
  const requestId=crypto.randomUUID();const r=await walletApi('/api/admin/users/'+encodeURIComponent(uid)+'/adjust-credit',{method:'POST',body:JSON.stringify({deltaSatang,reason,requestId})});
  const local=state.adminUsers.find(x=>x.uid===uid);if(local)local.balanceSatang=num(r.afterSatang);
  userFinancePanel.balanceSatang=num(r.afterSatang);
  $$('[data-user-row]').forEach(row=>{if(row.dataset.userUid===uid){const el=row.querySelector('.admin-credit-cell');if(el)el.textContent=bahtSatang(r.afterSatang)}});
  const money=form.querySelector('input[name=amount]');if(money)money.value='';const why=form.querySelector('input[name=reason]');if(why)why.value='';
  toast('ปรับยอดสำเร็จ คงเหลือ '+bahtSatang(r.afterSatang));
  await loadUserFinancialHistory(uid,false);
  if(uid===state.user?.uid)void loadWallet(false);
 }catch(e){toast(e.message,'error')}finally{state.busy=false;busyButton(btn,false)}
}
async function submitAdminPassword(form){if(state.busy)return;const v=new FormData(form),uid=String(v.get('uid')||''),pw=String(v.get('password')||''),confirmPw=String(v.get('confirm')||''),reason=String(v.get('reason')||'').trim();if(pw.length<10||pw!==confirmPw||reason.length<8)return toast('รหัสผ่านต้องตรงกัน ยาวอย่างน้อย 10 ตัว และกรอกเหตุผล','error');if(!(await askConfirm('รหัสผ่านเดิมของสมาชิกจะใช้ไม่ได้ และจะต้องเข้าสู่ระบบด้วยรหัสใหม่',{title:'ยืนยันเปลี่ยนรหัสผ่าน',confirmLabel:'เปลี่ยนรหัสผ่าน',danger:true,detail:'โปรดตรวจสอบว่าคุณได้รับอนุญาตให้แก้ไขบัญชีนี้'})))return;state.busy=true;const btn=form.querySelector('button[type="submit"]');busyButton(btn,true);try{await walletApi('/api/admin/users/'+encodeURIComponent(uid)+'/password',{method:'POST',body:JSON.stringify({newPassword:pw,reason})});form.reset();toast('เปลี่ยนรหัสผ่านสำเร็จ สมาชิกต้องเข้าสู่ระบบใหม่');if(uid===state.user?.uid){$('#editor-modal')?.remove();go('login')}}catch(e){toast(e.message,'error')}finally{state.busy=false;busyButton(btn,false)}}

function renderAdminSettings(){return adminFrame('admin-settings',`<div class="glass admin-panel"><form id="settings-form" class="admin-form"><label>ชื่อร้าน<input class="input" name="storeName" required maxlength="60" value="${safe(state.settings.storeName||'FIX STORE')}"></label><p class="notice muted">จัดการประกาศแบบหลายรายการได้ที่ <a href="${link('admin-announcements')}" style="color:#fff;text-decoration:underline">เมนูประกาศร้านค้า</a></p><p class="notice muted">ตั้งค่าช่องทางสำหรับหน้าติดต่อแอดมิน <a href="${link('contact')}" style="color:#fff;text-decoration:underline">เปิดดูหน้า Contact</a></p><label>Discord URL (HTTPS)<input class="input" name="discordUrl" value="${safe(state.settings.discordUrl||'')}" placeholder="https://discord.gg/..."></label><label>YouTube URL (HTTPS)<input class="input" name="youtubeUrl" value="${safe(state.settings.youtubeUrl||'')}" placeholder="https://www.youtube.com/@..."></label><label>LINE URL (HTTPS)<input class="input" name="lineUrl" value="${safe(state.settings.lineUrl||'')}" placeholder="https://line.me/..."></label><label>ช่องทางเพิ่มเติม (HTTPS)<input class="input" name="supportLink" value="${safe(state.settings.supportLink||'')}" placeholder="https://..."></label><div><button type="submit" class="btn btn-primary">บันทึกการตั้งค่า</button></div></form></div>`)}
function render(keepPosition=false){const {path}=route();state.current=path;document.title=(path==='home'?'FIX STORE':(admPages[path]?.[0]||{shop:'สินค้าทั้งหมด',login:'เข้าสู่ระบบ',register:'สมัครสมาชิก',cart:'ตะกร้าสินค้า',help:'ช่วยเหลือ',contact:'ติดต่อแอดมิน & ช่วยเหลือ','contact-admin':'ติดต่อแอดมิน',wallet:'เติมเครดิต','wallet-qr':'QR พร้อมเพย์','wallet-code':'โค้ดเติมเครดิต',orders:'คำสั่งซื้อ',account:'บัญชีของฉัน',product:'รายละเอียดสินค้า'}[path]||'FIX STORE'))+' | FIX STORE';const views={home:renderHome,shop:renderShop,product:renderProduct,login:()=>authView('login'),register:()=>authView('register'),cart:renderCart,wallet:renderWallet,'wallet-qr':()=>renderWalletMethod('qr'),'wallet-code':()=>renderWalletMethod('code'),account:renderAccount,orders:renderOrders,help:renderHelp,contact:renderContact,'contact-admin':renderContactAdmin,admin:renderDashboard,'admin-products':renderAdminProducts,'admin-categories':renderAdminCategories,'admin-announcements':renderAdminAnnouncements,'admin-stock':renderAdminStock,'admin-orders':renderAdminOrders,'admin-claims':renderAdminClaims,'admin-members':renderAdminMembers,'admin-topup-codes':renderAdminTopupCodes,'admin-discount-codes':renderAdminDiscountCodes,'admin-promotions':renderAdminTopupCodes,'admin-api':renderAdminAPI,'admin-settings':renderAdminSettings};if($('#editor-modal .user-control-v88'))stopFinanceLive();$('#editor-modal')?.remove();app.innerHTML=(views[path]||renderHome)();$$('[data-nav]').forEach(n=>n.classList.toggle('active',n.dataset.nav===path||(n.dataset.nav==='wallet'&&['wallet-qr','wallet-code'].includes(path))));$$('[data-mobile-nav]').forEach(n=>{const key=n.dataset.mobileNav;const active=(key==='shop'&&['shop','product'].includes(path))||(key==='account'&&['account','login','register'].includes(path))||key===path||(key==='wallet'&&['wallet-qr','wallet-code'].includes(path));n.classList.toggle('active',active);if(active)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current')});setStatus();renderFooter();renderAnnouncements();closeMobileAccountMenu();if(!keepPosition)window.scrollTo({top:0,behavior:'instant'});}
async function setAuthUser(user){stopFinanceLive();closeWalletAmountModal();const previous=state.user?.uid||null;if(previous!==user?.uid){state.walletSatang=0;state.walletLoaded=false;state.walletHistory=[];state.walletIntent=null;state.walletError=null;state.walletConfig=null;if(orderUnsubscribe){orderUnsubscribe();orderUnsubscribe=null}if(adminOrderUnsubscribe){adminOrderUnsubscribe();adminOrderUnsubscribe=null}if(claimUnsubscribe){claimUnsubscribe();claimUnsubscribe=null}if(cartUnsubscribe){cartUnsubscribe();cartUnsubscribe=null}if(walletBalanceUnsubscribe){walletBalanceUnsubscribe();walletBalanceUnsubscribe=null}if(walletLedgerUnsubscribe){walletLedgerUnsubscribe();walletLedgerUnsubscribe=null}for(const key of ['orders','adminOrders','claims','walletBalance','walletLedger','cart'])liveSignatures[key]='';state.claims=[];state.adminOrders=[];state.codeHistories={topup:{items:[],nextCursor:null,hasMore:false,loading:false,error:null},discount:{items:[],nextCursor:null,hasMore:false,loading:false,error:null}};closeWalletModal()}state.user=user?{uid:user.uid,username:(user.email||'').split('@')[0]}:null;state.admin=false;state.discountCode='';state.discountPreview=null;state.discountDrawer=false;if(user){try{const tok=await state.A.getIdTokenResult(user,false);state.admin=tok.claims.admin===true}catch(e){console.warn('Custom claim:',e)}}await loadCart();if(state.user)void loadWallet(false);setStatus();if(state.ready){subscribeCartRealtime();subscribeOrders();subscribeAdminOrders();subscribeClaims();subscribeWalletRealtime()}}
async function repairProfile(user,username){try{const ref=doc('users',user.uid);const d=await state.F.getDoc(ref);if(!d.exists())await state.F.setDoc(ref,{username,createdAt:now()});return true}catch(e){console.warn('Profile sync:',e);return false}}
async function submitAuth(form){const mode=form.dataset.mode,username=(form.elements.username.value||'').trim().toLowerCase(),password=form.elements.password.value||'',repeat=form.elements.confirm?.value||'';const err=$('#auth-error');if(err){err.hidden=true;err.textContent=''}if(!goodUser(username))return feedback('ชื่อผู้ใช้ต้องเป็น a-z, 0-9 หรือ _ จำนวน 4–20 ตัว');if(password.length<8)return feedback('รหัสผ่านต้องมีอย่างน้อย 8 ตัว');if(mode==='register'&&password!==repeat)return feedback('รหัสผ่านที่ยืนยันไม่ตรงกัน');if(!state.ready)return feedback('Firebase ยังเชื่อมต่อไม่สำเร็จ: '+errMsg(state.error));const btn=$('#auth-submit');busyButton(btn,true,mode==='register'?'กำลังสมัครสมาชิก...':'กำลังเข้าสู่ระบบ...');try{const cred=mode==='register'?await state.A.createUserWithEmailAndPassword(state.auth,alias(username),password):await state.A.signInWithEmailAndPassword(state.auth,alias(username),password);await setAuthUser(cred.user);toast(mode==='register'?'สมัครสมาชิกสำเร็จ':'เข้าสู่ระบบสำเร็จ');go('account');void repairProfile(cred.user,username).then(ok=>{if(!ok)toast('บัญชีเข้าได้แล้ว แต่บันทึกโปรไฟล์ไม่สำเร็จ กรุณาตรวจสอบ Firestore Rules','error')})}catch(e){console.error('Auth error:',e);feedback(errMsg(e))}finally{busyButton(btn,false)}}
function feedback(msg){const el=$('#auth-error');if(el){el.hidden=false;el.textContent=msg}else toast(msg,'error')}
async function changeCart(id,qty){
 if(!state.user){toast('กรุณาเข้าสู่ระบบก่อนเพิ่มสินค้า');return go('login')}
 const p=state.products.find(p=>p.id===id&&p.active!==false);
 // Out-of-stock products must remain removable even if they can no longer be purchased.
 if(qty>0){
  if(!p)return toast('ไม่พบสินค้าหรือสินค้าปิดขายแล้ว','error');
  if(!purchasable(p)||(!isManual(p)&&qty>num(p.stockCount)))return toast('สต็อกสินค้าไม่เพียงพอ','error');
 }
 if(state.busy)return;
 const uid=state.user.uid;
 state.busy=true;
 try{
  const ref=doc('carts',uid,'items',id);
  if(qty<=0)await state.F.deleteDoc(ref);
  else await state.F.setDoc(ref,{quantity:Math.floor(qty),updatedAt:now()});
  if(state.user?.uid!==uid)return;
  state.cart=state.cart.filter(c=>c.id!==id);
  if(qty>0)state.cart.push({id,quantity:Math.floor(qty)});
  state.discountPreview=null;
  setStatus();
  if(state.current==='cart')refreshCartPartial();
  else toast('บันทึกตะกร้าบน Firebase แล้ว');
 }catch(e){toast(errMsg(e),'error')}
 finally{state.busy=false;void reconcileUnavailableCartItems()}
}
async function adminLoad(page){if(!state.admin)return;try{if(['admin-claims','admin'].includes(page))void verifyAdminClaimOrders();if(['admin','admin-orders'].includes(page))await loadOrders(true);if(page==='admin-members')await loadAdminUsers();if(page==='admin-api')await loadApiMonitor();if(page==='admin-topup-codes')void loadCodeHistory('topup');if(page==='admin-discount-codes')void loadCodeHistory('discount');if(page==='admin-stock'){state.stockProduct=state.stockProduct||state.products[0]?.id||'';await loadStock(state.stockProduct)}}catch(e){toast(errMsg(e),'error')}}
async function loadStock(id){state.stockProduct=id;state.stock=[];if(!id)return;try{const q=state.F.query(col('products',id,'stock'),state.F.limit(200));const snap=await state.F.getDocs(q);state.stock=snap.docs.map(d=>({id:d.id,...d.data()}))}catch(e){toast(errMsg(e),'error')}}
async function saveProduct(form){if(!state.admin)return toast('ต้องมีสิทธิ์ Admin เพื่อเพิ่มสินค้า','error');const v=new FormData(form),id=String(v.get('id')||''),old=state.products.find(p=>p.id===id),name=String(v.get('name')||'').trim(),cat=String(v.get('category')||''),rawPrice=String(v.get('price')||'').trim(),cost=Number(rawPrice),photo=String(v.get('imageUrl')||'').trim();const fail=msg=>{const x=$('#product-form-error');if(x){x.textContent=msg;x.hidden=false}toast(msg,'error')};if(!name||name.length>100)return fail('กรุณาระบุชื่อสินค้าไม่เกิน 100 ตัวอักษร');if(!cat||!state.categories.some(c=>c.id===cat&&(c.active!==false||old?.category===cat)))return fail('กรุณาสร้างหมวดหมู่ที่เปิดใช้งาน แล้วเลือกหมวดหมู่ของสินค้า');if(!rawPrice||!Number.isFinite(cost)||cost<0||cost>1000000)return fail('กรุณาใส่ราคาที่ถูกต้องระหว่าง 0–1,000,000 บาท');if(!DELIVERY_MODES[String(v.get('deliveryMode'))])return fail('กรุณาเลือกวิธีจัดส่ง');if(photo&&!https(photo))return fail('รูปภาพต้องใช้ลิงก์ HTTPS');
 const rawGallery=Array.from({length:5},(_,i)=>String(v.get('galleryImage'+(i+1))||'').trim()).filter(Boolean);
 if(rawGallery.length&&!photo)return fail('กรุณาใส่รูปปกสินค้าก่อนเพิ่มรูปอื่น');
 if(rawGallery.some(src=>!https(src)||src.length>500))return fail('รูปเพิ่มเติมต้องเป็นลิงก์ HTTPS ที่ถูกต้องและไม่เกิน 500 ตัวอักษร');
 const galleryImages=[...new Set(rawGallery.map(https))].filter(src=>src!==https(photo));
 const data={name:name.slice(0,100),category:cat,price:cost,art:String(v.get('art')||'✦').slice(0,5),badge:String(v.get('badge')||'').slice(0,18),imageUrl:photo.slice(0,500),galleryImages,description:String(v.get('description')||'').slice(0,1500),deliveryMode:String(v.get('deliveryMode')||'instant'),featured:v.get('featured')==='on',active:v.get('active')==='on',stockCount:num(old?.stockCount),sort:num(old?.sort)||Date.now()};const btn=form.querySelector('button[type=submit]');busyButton(btn,true,'กำลังบันทึกลง Firebase...');try{const categoryRef=await state.F.getDoc(doc('categories',cat));if(!categoryRef.exists())return fail('หมวดหมู่นี้ถูกลบแล้ว กรุณาโหลดหน้าใหม่และเลือกหมวดหมู่อีกครั้ง');if(id)await state.F.updateDoc(doc('products',id),data);else await state.F.addDoc(col('products'),data);await loadProducts();$('#editor-modal')?.remove();render();toast('บันทึกสินค้าใน Firebase สำเร็จ')}catch(e){console.error('[FIX STORE] saveProduct:',e);const hint=e?.code==='permission-denied'?' — สิทธิ์ Admin หรือ Firestore Rules ของ products ยังไม่อนุญาต':' ';fail('เพิ่มสินค้าไม่สำเร็จ: '+errMsg(e)+hint)}finally{busyButton(btn,false)}}
async function saveStock(form){const id=form.elements.product.value,lines=[...new Set(String(form.elements.codes.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];if(!id||!lines.length)return toast('กรุณาเลือกสินค้าและกรอกโค้ด','error');if(lines.length>100||lines.some(x=>x.length>300))return toast('ได้สูงสุด 100 โค้ด ครั้งละไม่เกิน 300 ตัวอักษรต่อบรรทัด','error');const existing=new Set(state.stock.map(x=>x.code));const add=lines.filter(x=>!existing.has(x));if(!add.length)return toast('โค้ดเหล่านี้มีอยู่แล้ว','error');try{const batch=state.F.writeBatch(state.db);for(const code of add){const d=state.F.doc(col('products',id,'stock'));batch.set(d,{code,status:'available',createdAt:now()})}batch.update(doc('products',id),{stockCount:state.F.increment(add.length)});await batch.commit();await loadProducts();await loadStock(id);render();toast('เติมสต็อก '+add.length+' โค้ดสำเร็จ')}catch(e){toast(errMsg(e),'error')}}
async function deleteStock(id){const prod=state.stockProduct,stock=state.stock.find(x=>x.id===id);if(!stock||stock.status!=='available')return;if(!(await askConfirm('โค้ดสต็อกนี้จะถูกลบออกจากสินค้าอย่างถาวร',{title:'ยืนยันลบสต็อก',confirmLabel:'ลบโค้ด',danger:true})))return;try{const batch=state.F.writeBatch(state.db);batch.delete(doc('products',prod,'stock',id));batch.update(doc('products',prod),{stockCount:state.F.increment(-1)});await batch.commit();await loadProducts();await loadStock(prod);render();toast('ลบสต็อกแล้ว')}catch(e){toast(errMsg(e),'error')}}
async function deleteProduct(id){const p=state.products.find(x=>x.id===id);if(!p)return;if(num(p.stockCount)>0)return toast('ยังมีสต็อก กรุณาปิดขายแทนการลบ','error');if(!(await askConfirm(`ลบสินค้า ${p.name} จากร้านค้า`,{title:'ยืนยันลบสินค้า',confirmLabel:'ลบสินค้า',danger:true,detail:'การลบรายการไม่สามารถย้อนกลับจากหน้าเว็บได้'})))return;try{await state.F.deleteDoc(doc('products',id));await loadProducts();render();toast('ลบสินค้าแล้ว')}catch(e){toast(errMsg(e),'error')}}
async function updateOrder(id,status){if(!ST[status])return;try{await state.F.updateDoc(doc('orders',id),{status,updatedAt:now()});await loadOrders(true);render();toast('อัปเดตสถานะสำเร็จ')}catch(e){toast(errMsg(e),'error')}}
function dateText(o){return o?.createdAt?.toDate?.().toLocaleString('th-TH')||date(o?.createdAt)}
function deliveredEntries(order){return Array.isArray(order?.deliveredItems)?order.deliveredItems:[]}
function getOrder(id){return (state.admin?[...state.adminOrders,...state.orders]:state.orders).find(o=>o.id===id)}
function copyText(value){
 const txt=String(value??'');
 if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(txt).then(()=>toast('คัดลอกแล้ว')).catch(()=>fallbackCopy(txt));
 return fallbackCopy(txt);
}
function fallbackCopy(txt){
 const a=document.createElement('textarea');a.value=txt;a.style.position='fixed';a.style.left='-5000px';document.body.appendChild(a);a.focus();a.select();
 const ok=document.execCommand('copy');a.remove();toast(ok?'คัดลอกแล้ว':'ไม่สามารถคัดลอกอัตโนมัติได้','error');
}
function decodeNetflix(code){
 const s=String(code||'').split('|').map(v=>v.trim());
 if(s.length<2)return [{label:'ข้อมูลบัญชี',value:String(code)}];
 return [{label:'อีเมล / Username',value:s[0]},{label:'รหัสผ่าน',value:s[1]},...(s[2]?[{label:'โปรไฟล์',value:s[2]}]:[]),...(s[3]?[{label:'PIN',value:s[3]}]:[])];
}
function showOrderDetails(id){
 const o=getOrder(id);if(!o)return toast('ไม่พบคำสั่งซื้อ','error');
 const rows=deliveredEntries(o),allCodes=rows.flatMap(it=>it.codes||[]).join('\n');
 const items=Array.isArray(o.items)?o.items:[];
 const totalPrice=orderHistoryPaidBaht(o);
 const totalQty=items.reduce((n,r)=>n+num(r.quantity),0);
 const firstProduct=state.products.find(p=>p.id===items[0]?.productId)||items[0]||{name:'FIX STORE'};
 const thumb=art(firstProduct,'history-order-thumb');
 const detailBlocks=rows.length?rows.map(it=>`<section class="history-order-block"><div class="history-order-block-head"><div><strong>${safe(it.name||'สินค้า')}</strong>${claimBadge(ownProductClaim(o.id,it.productId))}</div><span>${(it.codes||[]).length||0} รายการ</span></div>${(it.codes||[]).length?it.codes.map((code,i)=>{const fields=it.deliveryMode==='netflix'?decodeNetflix(code):[{label:'รหัส / ข้อมูลสินค้า',value:String(code)}];return `<div class="history-code-panel"><div class="history-code-panel-title">รายการ ${i+1}</div>${fields.map(f=>`<div class="history-code-row"><label>${safe(f.label)}</label><div class="history-code-value">${safe(f.value)}</div><button type="button" class="history-inline-copy" data-action="copy-code" data-value="${safe(f.value)}">คัดลอก</button></div>`).join('')}</div>`}).join(''):`<div class="delivery-pending clean-pending">รอแอดมินส่งข้อมูลสำหรับสินค้านี้</div>`}</section>`).join(''):'<div class="delivery-pending clean-pending">ยังไม่มีรหัสสำหรับออเดอร์นี้ กรุณารอร้านยืนยันการชำระเงินและจัดส่ง</div>';
 document.body.insertAdjacentHTML('beforeend',`<div id="editor-modal" class="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="ดูข้อมูลคำสั่งซื้อ" class="modal order-detail-modal history-clean-modal"><div class="history-modal-head"><div class="history-modal-product">${thumb}<div><span class="eyebrow">ข้อมูลสินค้าของคุณ</span><h2>${safe(items.map(i=>i.name).join(', ')||'FIX STORE')}</h2><p>สั่งซื้อเมื่อ ${date(o.createdAt)}</p></div></div><button type="button" data-action="close-modal" class="history-modal-close" aria-label="ปิด">×</button></div><div class="history-modal-body"><div class="history-modal-summary"><div><span>สถานะคำสั่งซื้อ</span><strong class="history-detail-status ${safe(o.status)}">${safe(ST[o.status]||o.status)}</strong></div><div><span>ยอดรวม</span><strong>${price(totalPrice)}</strong></div><div><span>จำนวนสินค้า</span><strong>${totalQty} ชิ้น</strong></div></div><div class="history-modal-section"><div class="history-modal-section-head"><strong>รายละเอียดบัญชี / รหัสสินค้า</strong><span>${rows.length||0} รายการ / ทั้งหมด ${items.length}</span></div>${detailBlocks}</div></div><div class="history-modal-footer"><button type="button" class="history-main-btn history-main-btn-light" data-action="copy-order" data-id="${safe(o.id)}">คัดลอกเลขออเดอร์</button>${allCodes?`<button type="button" class="history-main-btn" data-action="copy-all-codes" data-id="${safe(o.id)}">คัดลอกทั้งหมด</button>`:''}</div></section></div>`);
}
function showClaimModal(id){
 const order=state.orders.find(o=>o.id===id);
 if(!order||order.status!=='completed')return toast('เคลมได้เมื่อคำสั่งซื้อสำเร็จแล้ว','error');
 const items=Array.isArray(order.items)?order.items.filter(it=>it&&it.productId&&!ownProductClaim(order.id,it.productId)):[];
 if(!items.length)return toast('สินค้าทุกชิ้นในคำสั่งซื้อนี้มีคำขอเคลมแล้ว','info');
 // Native radio choices avoid inconsistent operating-system select popups.
 // The existing submitClaim() still receives exactly the same productId and orderId values.
 const options=items.map((it,i)=>{
  const product=state.products.find(p=>p.id===it.productId)||it;
  const src=https(product.imageUrl);
  const thumb=src?`<img src="${safe(src)}" alt="" loading="lazy">`:`${ico('box')}`;
  return `<label class="claim-v39-option"><input type="radio" name="productId" value="${safe(it.productId)}" ${i===0?'checked':''} required><span class="claim-v39-option-art" aria-hidden="true">${thumb}</span><span class="claim-v39-option-name"><strong>${safe(it.name||'สินค้า')}</strong><small>จำนวน ${num(it.quantity)||1} ชิ้น</small></span><span class="claim-v39-choice-mark" aria-hidden="true">${ico('check')}</span></label>`;
 }).join('');
 document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="editor-modal"><section class="modal order-detail-modal claim-v39-modal" role="dialog" aria-modal="true" aria-labelledby="claim-v39-title"><header class="claim-v39-header"><div class="claim-v39-heading"><span class="claim-v39-eyebrow">FIX STORE · SUPPORT</span><h2 id="claim-v39-title">แจ้งสินค้ามีปัญหา</h2><p>ระบุสินค้าและอธิบายปัญหาที่พบ</p></div><button type="button" data-action="close-modal" class="claim-v39-close" aria-label="ปิดหน้าต่าง">×</button></header><form id="claim-form" class="claim-v39-form"><input type="hidden" name="orderId" value="${safe(id)}"><div class="claim-v39-section"><div class="claim-v39-section-label">สินค้าที่ต้องการแจ้ง${items.length>1?`<small>เลือก 1 รายการ</small>`:''}</div><div class="claim-v39-options ${items.length===1?'is-single':''}" role="group" aria-label="เลือกสินค้าที่มีปัญหา">${options}</div></div><div class="claim-v39-section claim-v39-description-section"><label for="claim-v39-description" class="claim-v39-section-label">รายละเอียดปัญหา</label><textarea id="claim-v39-description" name="description" required minlength="10" maxlength="1500" rows="5" placeholder="อธิบายปัญหาที่พบ เช่น เข้าใช้งานไม่ได้ หรือรหัสไม่ถูกต้อง"></textarea><div class="claim-v39-help"><span>กรุณาระบุรายละเอียดอย่างน้อย 10 ตัวอักษร</span><span id="claim-v39-count" aria-live="off">0/1500</span></div></div><p class="claim-v39-notice">คำขอของคุณจะถูกส่งให้แอดมินตรวจสอบ สามารถติดตามความคืบหน้าได้จากทางร้าน</p><footer class="claim-v39-footer"><button type="button" class="claim-v39-btn claim-v39-cancel" data-action="close-modal">ยกเลิก</button><button class="claim-v39-btn claim-v39-submit" type="submit">ส่งคำขอเคลม ${ico('arrow')}</button></footer></form></section></div>`);
 const area=$('#claim-v39-description'),counter=$('#claim-v39-count');
 area?.addEventListener('input',()=>{if(counter)counter.textContent=`${area.value.length}/1500`;});
}
async function submitClaim(form){
 if(!state.ready||!state.user)return toast('กรุณาเข้าสู่ระบบก่อน','error');
 const v=new FormData(form),id=String(v.get('orderId')||''),pid=String(v.get('productId')||''),description=String(v.get('description')||'').trim();
 const o=state.orders.find(x=>x.id===id),it=o?.items?.find(x=>x.productId===pid);
 if(o?.status!=='completed'||!it||description.length<10||description.length>1500)return toast('รายละเอียดการเคลมไม่ถูกต้อง','error');
 const btn=form.querySelector('[type=submit]');busyButton(btn,true,'กำลังส่งคำขอ...');
 try{
  const claimId=[id,pid,state.user.uid].join('_');
  await state.F.setDoc(doc('claims',claimId),{orderId:id,productId:pid,productName:it.name,userId:state.user.uid,username:state.user.username,description,status:'pending',createdAt:now()});
  $('#editor-modal')?.remove();toast('ส่งคำขอเคลมแล้ว · สถานะรอเคลม');
 }catch(e){toast('ส่งเคลมไม่ได้ (เคสนี้อาจเคยแจ้งแล้ว): '+errMsg(e),'error')}
 finally{busyButton(btn,false)}
}
function renderAdminClaims(){
 const all=visibleAdminClaims();
 const pending=all.filter(c=>['pending','reviewing'].includes(c.status));
 const closed=all.filter(c=>['resolved','refunded','rejected'].includes(c.status));
 const tab=state.adminClaimTab==='closed'?'closed':'pending';
 const list=tab==='pending'?pending:closed;
 return adminFrame('admin-claims',`<section class="glass admin-panel claim-management-panel"><div class="admin-toolbar"><div><strong>จัดการคำขอเคลม</strong><p class="muted">เคลมที่ออเดอร์ถูกลบจะไม่แสดง · คืนเครดิตได้เฉพาะคำสั่งซื้อที่จ่ายผ่านเครดิต</p></div><button class="btn ${state.soundEnabled?'btn-primary':'btn-ghost'} btn-small" data-action="toggle-bell">${state.soundEnabled?'ปิดเสียงกระดิ่ง':'เปิดเสียงกระดิ่ง'}</button></div><div class="claim-filter-tabs" role="group" aria-label="เลือกสถานะเคลม"><button type="button" data-action="admin-claims-tab" data-tab="pending" class="${tab==='pending'?'active':''}" aria-pressed="${tab==='pending'}">รอเคลม <span>${pending.length}</span></button><button type="button" data-action="admin-claims-tab" data-tab="closed" class="${tab==='closed'?'active':''}" aria-pressed="${tab==='closed'}">เคลมสำเร็จ / ปิดเคส <span>${closed.length}</span></button></div><div class="claim-list">${list.length?list.map(c=>`<article class="claim-row claim-repair-row"><div class="claim-meta"><div class="claim-repair-head"><strong>${safe(c.productName||'สินค้า')}</strong><span class="claim-state-badge ${safe(c.status||'pending')}">${safe(CLAIM_STATUS_TEXT[c.status]||c.status||'รอเคลม')}</span></div><small>ผู้แจ้ง ${safe(c.username||'-')} · ออเดอร์ ${safe(c.orderId)} · ${date(c.createdAt)}</small><p>${safe(c.description||'')}</p></div><div class="claim-actions claim-repair-actions">${tab==='pending'?`<button type="button" class="mini-btn claim-edit-btn" data-action="edit-claim" data-id="${safe(c.id)}">${ico('edit')} แก้ไขเคลม</button><select class="input claim-status-select" data-claim-status="${safe(c.id)}" aria-label="อัปเดตสถานะเคลม"><option value="pending" ${c.status==='pending'?'selected':''}>รอเคลม</option><option value="reviewing" ${c.status==='reviewing'?'selected':''}>กำลังตรวจสอบ</option><option value="rejected">ไม่ผ่านเงื่อนไข</option></select>`:''}<button type="button" class="mini-btn" data-action="view-order" data-id="${safe(c.orderId)}">ดูออเดอร์</button></div></article>`).join(''):`<div class="shelf-empty">${tab==='pending'?'ไม่มีรายการรอเคลม':'ยังไม่มีเคสที่ดำเนินการเสร็จ'}</div>`}</div></section>`);
}
async function updateClaimStatus(id,status){
 if(!state.admin||!['pending','reviewing','rejected'].includes(status))return;
 try{await state.F.updateDoc(doc('claims',id),{status,updatedAt:now()});toast('อัปเดตสถานะเคลมแล้ว')}
 catch(e){toast('เปลี่ยนสถานะเคลมไม่สำเร็จ: '+errMsg(e),'error')}
}
async function showClaimResolutionModal(id){
 if(!state.admin)return toast('บัญชีนี้ไม่มีสิทธิ์จัดการเคลม','error');
 const claim=state.claims.find(c=>c.id===id);
 if(!claim||!['pending','reviewing'].includes(claim.status))return toast('เคสนี้ไม่อยู่ระหว่างรอแก้ไข','error');
 let order=state.adminOrders.find(o=>o.id===claim.orderId);
 if(!order){try{const snap=await state.F.getDoc(doc('orders',claim.orderId));if(snap.exists())order={id:snap.id,...snap.data()}}catch(e){return toast('อ่านออเดอร์ไม่ได้: '+errMsg(e),'error')}}
 const item=order?.items?.find(it=>it.productId===claim.productId);
 if(!item||order.status!=='completed')return toast('ไม่พบคำสั่งซื้อที่จัดส่งสำเร็จ กรุณาตรวจสอบข้อมูลคำสั่งซื้อ','error');
 const qty=num(item.quantity);
 if(!Number.isInteger(qty)||qty<1||qty>50)return toast('จำนวนสินค้าไม่ถูกต้อง กรุณาตรวจสอบออเดอร์','error');
 const product=state.products.find(p=>p.id===claim.productId);
 const available=product?num(product.stockCount):0;
 const canRefund=order.paymentMethod==='wallet'&&order.paidSatang!==undefined&&order.paidSatang!==null&&Number.isSafeInteger(Number(order.paidSatang))&&Number(order.paidSatang)>=0;
 $('#editor-modal')?.remove();
 document.body.insertAdjacentHTML('beforeend',`<div id="editor-modal" class="modal-backdrop"><section class="glass modal claim-resolve-modal" role="dialog" aria-modal="true" aria-labelledby="claim-resolve-title"><header class="claim-resolve-header"><div><span class="eyebrow">FIX STORE / CLAIM RESOLUTION</span><h2 id="claim-resolve-title">แก้ไขเคลมสินค้า</h2><p>${safe(claim.productName||item.name||'สินค้า')} · จำนวน ${qty} ชิ้น</p></div><button type="button" class="claim-resolve-close" data-action="close-modal" aria-label="ปิด">×</button></header><div class="claim-resolve-issue"><span>รายละเอียดที่ลูกค้าแจ้ง</span><p>${safe(claim.description||'-')}</p></div><form id="claim-resolve-form" class="claim-resolve-form"><input type="hidden" name="claimId" value="${safe(claim.id)}"><fieldset class="claim-resolve-modes"><legend>เลือกวิธีจัดการเคลม</legend><label class="claim-resolve-method"><input type="radio" name="source" value="manual" checked><span><strong>กรอกข้อมูลใหม่</strong><small>ส่งรหัสหรือข้อมูลใหม่ให้ลูกค้าโดยตรง</small></span></label><label class="claim-resolve-method"><input type="radio" name="source" value="stock" ${available<qty?'disabled':''}><span><strong>ใช้โค้ดในสต็อก</strong><small>มีอยู่ ${available} ชิ้น · ต้องใช้ ${qty} ชิ้น${available<qty?' · สต็อกไม่พอ':''}</small></span></label><label class="claim-resolve-method claim-refund-method"><input type="radio" name="source" value="refund" ${canRefund?'':'disabled'}><span><strong>คืนเครดิตและยกเลิกออเดอร์</strong><small>${canRefund?`คืนยอดที่ชำระจริง ${price(orderHistoryPaidBaht(order))} ให้เจ้าของออเดอร์ทั้งรายการ`:'ไม่มีข้อมูลยอดชำระผ่านเครดิตที่ยืนยันได้ ไม่สามารถคืนอัตโนมัติ'}</small></span></label></fieldset><div class="claim-resolve-manual"><label for="claim-resolve-codes">รหัสหรือข้อมูลสำหรับส่งทดแทน</label><textarea class="input" id="claim-resolve-codes" name="codes" rows="5" maxlength="15050" placeholder="ใส่ข้อมูลใหม่ 1 บรรทัดต่อ 1 ชิ้น&#10;จำนวนที่ต้องกรอก ${qty} บรรทัด" required></textarea><small>ต้องกรอก ${qty} บรรทัด · บรรทัดละไม่เกิน 300 ตัวอักษร</small></div><div class="claim-resolve-stock-note" hidden>ระบบจะดึงโค้ดที่ยังไม่ถูกใช้จากสต็อก ลดจำนวนคงเหลือ และเปลี่ยนข้อมูลในคำสั่งซื้อให้ลูกค้าอัตโนมัติ</div><div class="claim-resolve-refund-note" hidden>คืนเครดิตเต็มจำนวนที่ชำระจริง และเปลี่ยนสถานะคำสั่งซื้อเป็นยกเลิก ไม่คืนรหัสที่เคยส่งแล้วเข้าสู่สต็อกโดยอัตโนมัติ</div><div class="claim-resolve-footer"><button type="button" class="btn btn-ghost" data-action="close-modal">ยกเลิก</button><button type="submit" class="btn btn-primary claim-resolve-submit">ยืนยันส่งข้อมูลและจบเคลม</button></div></form></section></div>`);
}
async function submitClaimResolution(form){
 if(!state.admin||!state.ready||!state.user)return toast('บัญชีนี้ไม่มีสิทธิ์แก้ไขเคลม','error');
 if(state.busy)return;
 const values=new FormData(form),claimId=String(values.get('claimId')||'');
 const source=String(values.get('source')||'manual');
 const claim=state.claims.find(c=>c.id===claimId);
 if(!claim||!['pending','reviewing'].includes(claim.status))return toast('เคสนี้ถูกเปลี่ยนสถานะแล้ว','error');
 let order=state.adminOrders.find(o=>o.id===claim.orderId);
 if(!order){try{const snap=await state.F.getDoc(doc('orders',claim.orderId));if(snap.exists())order={id:snap.id,...snap.data()}}catch(e){return toast('อ่านออเดอร์ไม่ได้: '+errMsg(e),'error')}}
 const item=order?.items?.find(it=>it.productId===claim.productId);
 if(!item||order.status!=='completed'||order.userId!==claim.userId)return toast('ข้อมูลเคลมหรือออเดอร์ไม่ตรงกัน','error');
 const qty=num(item.quantity);
 if(!Number.isInteger(qty)||qty<1||qty>50)return toast('จำนวนสินค้าไม่ถูกต้อง','error');
 if(source==='refund'){
  if(order.paymentMethod!=='wallet'||order.paidSatang===undefined||order.paidSatang===null||!Number.isSafeInteger(Number(order.paidSatang))||Number(order.paidSatang)<0)return toast('ไม่พบยอดชำระผ่านเครดิตที่คืนได้','error');
  if(!(await askConfirm(`คืนเครดิต ${price(orderHistoryPaidBaht(order))} และยกเลิกออเดอร์ ${claim.orderId} ทั้งรายการใช่หรือไม่?`,
   {title:'ยืนยันคืนเครดิตและยกเลิกคำสั่งซื้อ',confirmLabel:'คืนเครดิตและยกเลิก',danger:true,
    detail:'ระบบจะคืนยอดที่ชำระจริงให้ผู้ซื้อ และบันทึกประวัติการคืนเงิน · ไม่สามารถกดคืนซ้ำได้'})))return;
  const button=form.querySelector('[type="submit"]');
  state.busy=true;
  if(button)busyButton(button,true,'กำลังคืนเครดิต...');
  try{
   const result=await walletApi('/api/admin/claims/'+encodeURIComponent(claimId)+'/refund',{method:'POST',body:'{}'});
   $('#editor-modal')?.remove();
   toast('คืนเครดิตสำเร็จ '+price(num(result.amountSatang)/100)+' · ยกเลิกออเดอร์แล้ว');
   await Promise.allSettled([loadOrders(true)]);
   if(state.current==='admin-claims')scheduleLiveUpdate();
  }catch(e){toast('คืนเครดิตไม่สำเร็จ: '+e.message,'error')}
  finally{state.busy=false;if(button?.isConnected)busyButton(button,false)}
  return;
 }
 const codes=source==='manual'?String(values.get('codes')||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean):[];
 if(source==='manual'&&(codes.length!==qty||codes.some(c=>c.length>300)||new Set(codes).size!==qty))return toast(`กรุณากรอกข้อมูลใหม่ ${qty} บรรทัด ไม่ซ้ำกัน และไม่เกิน 300 ตัวอักษรต่อบรรทัด`,'error');
 if(source!=='manual'&&source!=='stock')return toast('วิธีส่งข้อมูลไม่ถูกต้อง','error');
 const button=form.querySelector('[type="submit"]');
 if(button)busyButton(button,true,'กำลังอัปเดตคำสั่งซื้อ...');
 state.busy=true;
 try{
  const chosen=source==='stock'?await chooseStock(claim.productId,qty,'instant'):[];
  await state.F.runTransaction(state.db,async tx=>{
   const claimRef=doc('claims',claimId),orderRef=doc('orders',claim.orderId);
   const claimDoc=await tx.get(claimRef),orderDoc=await tx.get(orderRef);
   if(!claimDoc.exists()||!['pending','reviewing'].includes(claimDoc.data().status))throw Error('เคลมนี้ถูกดำเนินการไปแล้ว');
   if(!orderDoc.exists()||orderDoc.data().status!=='completed')throw Error('ออเดอร์นี้ไม่อยู่ในสถานะจัดส่งสำเร็จ');
   const c=claimDoc.data(),o=orderDoc.data();
   if(c.orderId!==claim.orderId||c.productId!==claim.productId||c.userId!==o.userId)throw Error('ข้อมูลเคลมไม่ตรงกับเจ้าของออเดอร์');
   const liveItem=(o.items||[]).find(it=>it.productId===c.productId);
   if(!liveItem||num(liveItem.quantity)!==qty)throw Error('รายการหรือจำนวนสินค้าถูกเปลี่ยนแปลง');
   let productSnap=null;const stockSnaps=[];
   if(source==='stock'){
    productSnap=await tx.get(doc('products',c.productId));
    if(!productSnap.exists()||num(productSnap.data().stockCount)<qty)throw Error('สต็อกสินค้าไม่เพียงพอ');
    for(const row of chosen){
     const stockSnap=await tx.get(doc('products',c.productId,'stock',row.id));
     if(!stockSnap.exists()||stockSnap.data().status!=='available'||typeof stockSnap.data().code!=='string')throw Error('สต็อกบางรายการถูกใช้ไปแล้ว กรุณาลองใหม่');
     stockSnaps.push(stockSnap);
    }
    if(stockSnaps.length!==qty)throw Error('จำนวนสต็อกไม่ครบ');
   }
   // All documents are read before any write, as required by Firestore transactions.
   const replacement=source==='stock'?stockSnaps.map(s=>s.data().code):codes;
   const delivered=deliveredEntries(o);
   const index=delivered.findIndex(it=>it.productId===c.productId);
   if(index===-1)throw Error('ออเดอร์นี้ไม่มีข้อมูลจัดส่งของสินค้าที่เคลม');
   const current=delivered[index];
   if(replacement.some(v=>(current.codes||[]).includes(v)))throw Error('ข้อมูลทดแทนต้องไม่ซ้ำกับข้อมูลเดิม');
   const updated=delivered.map((it,i)=>i===index?{...it,codes:replacement}:it);
   tx.update(orderRef,{deliveredItems:updated,updatedAt:now()});
   if(source==='stock'){
    for(const stockSnap of stockSnaps)tx.delete(doc('products',c.productId,'stock',stockSnap.id));
    // Replacement is not an additional sale; do not increment soldCount.
    tx.update(doc('products',c.productId),{stockCount:state.F.increment(-qty)});
   }
   tx.update(claimRef,{status:'resolved',updatedAt:now()});
  });
  $('#editor-modal')?.remove();
  toast('ส่งข้อมูลทดแทนแล้ว · เคลมสำเร็จ');
  await Promise.allSettled([loadOrders(true)]);
  if(state.current==='admin-claims')scheduleLiveUpdate();
 }catch(e){console.error('[FIX STORE] claim resolution:',e);toast('แก้ไขเคลมไม่สำเร็จ: '+errMsg(e),'error')}
 finally{state.busy=false;if(button?.isConnected)busyButton(button,false)}
}
async function chooseStock(productId,qty,mode){
 const snap=await state.F.getDocs(state.F.query(col('products',productId,'stock'),state.F.limit(400)));
 const rows=snap.docs.filter(d=>d.data().status==='available');
 if(rows.length<qty)throw Error('สต็อก '+productId+' ไม่เพียงพอ ('+rows.length+'/'+qty+')');
 if(mode==='random'){
  const a=[...rows];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a.slice(0,qty);
 }
 return rows.sort((a,b)=>(a.data().createdAt?.seconds||0)-(b.data().createdAt?.seconds||0)).slice(0,qty);
}
async function approveAndDeliver(id){
 if(!state.admin)return;
 const order=state.adminOrders.find(o=>o.id===id);
 if(!order||order.status!=='pending')return toast('ออเดอร์ไม่ได้อยู่ระหว่างรอยืนยัน','error');
 if(!(await askConfirm('คุณได้ตรวจสอบว่ารับชำระเงินของออเดอร์ '+id+' จริงแล้วใช่หรือไม่?\nระบบจะส่งรหัสและลบออกจากสต็อกทันที',{title:'ยืนยันชำระเงินและส่งสินค้า',confirmLabel:'ยืนยันจัดส่ง',danger:true,detail:'โปรดตรวจสอบหลักฐานรับเงินก่อนส่งโค้ด การจัดส่งไม่สามารถยกเลิกได้'})))return;
 if(state.busy)return;state.busy=true;
 try{
  const selected=[];
  if((order.items||[]).reduce((sum,i)=>sum+num(i.quantity),0)>50)throw Error('การส่งสินค้าครั้งเดียวรองรับสูงสุด 50 ชิ้น กรุณาแยกออเดอร์');
  for(const it of order.items||[]){
   const p=state.products.find(p=>p.id===it.productId);
   if(!p)throw Error('ไม่พบสินค้า '+it.name);
   const mode=deliveryMode(p),qty=num(it.quantity);
   if(!Number.isInteger(qty)||qty<1||qty>50)throw Error('จำนวนสินค้าไม่ถูกต้อง');
   selected.push({it,p,mode,qty,entries:mode==='manual'?[]:await chooseStock(p.id,qty,mode)});
  }
  await state.F.runTransaction(state.db,async tx=>{
   const orderRef=doc('orders',id),live=await tx.get(orderRef);
   if(!live.exists()||live.data().status!=='pending')throw Error('ออเดอร์นี้ถูกดำเนินการไปแล้ว');
   const checked=[];
   for(const row of selected){
    const productSnapshot=await tx.get(doc('products',row.p.id));
    if(!productSnapshot.exists())throw Error('สินค้าถูกลบแล้ว');
    if(productSnapshot.data().active===false)throw Error('สินค้า '+row.it.name+' ถูกปิดขายแล้ว');
    if(deliveryMode(productSnapshot.data())!==row.mode)throw Error('วิธีส่งของสินค้าเปลี่ยนไป โปรดสร้างออเดอร์ใหม่');
    if(num(productSnapshot.data().price)!==num(row.it.price)||productSnapshot.data().name!==row.it.name)throw Error('ราคาหรือชื่อสินค้าเปลี่ยนไป โปรดตรวจสอบคำสั่งซื้อและให้ลูกค้าสั่งใหม่ (ป้องกันออเดอร์ปลอม)');
    const stockDocs=[];
    for(const e of row.entries){
     const snapshot=await tx.get(doc('products',row.p.id,'stock',e.id));
     if(!snapshot.exists()||snapshot.data().status!=='available')throw Error('สต็อกบางรายการถูกใช้ไปแล้ว กรุณากดจัดส่งอีกครั้ง');
     stockDocs.push(snapshot);
    }
    if(row.mode!=='manual'&&stockDocs.length!==row.qty)throw Error('จำนวนสต็อกไม่ครบ');
    if(row.mode!=='manual'&&num(productSnapshot.data().stockCount)<row.qty)throw Error('สต็อกสินค้าไม่เพียงพอ');
    checked.push({...row,stockDocs});
   }
   // All transaction reads above; only now are document writes allowed.
   const delivered=[];
   for(const row of checked){
    delivered.push({productId:row.p.id,name:row.it.name,quantity:row.qty,deliveryMode:row.mode,codes:row.stockDocs.map(d=>d.data().code)});
    if(row.mode==='manual')continue;
    for(const d of row.stockDocs)tx.delete(doc('products',row.p.id,'stock',d.id));
    tx.update(doc('products',row.p.id),{stockCount:state.F.increment(-row.qty),soldCount:state.F.increment(row.qty)});
   }
   const pendingManual=checked.some(r=>r.mode==='manual');
   tx.update(orderRef,{status:pendingManual?'processing':'completed',deliveredItems:delivered,fulfilledAt:now(),updatedAt:now(),paymentReviewedAt:now()});
  });
  toast('จัดส่งสำเร็จและตัดสต็อกแล้ว');await loadOrders(true);render();
 }catch(e){console.error('delivery transaction:',e);toast('จัดส่งไม่สำเร็จ ไม่มีการตัดสต็อก: '+errMsg(e),'error')}
 finally{state.busy=false}
}
function showManualDelivery(id){
 const o=state.adminOrders.find(o=>o.id===id);
 if(!o||o.status!=='processing')return toast('ออเดอร์นี้ไม่อยู่ระหว่างจัดส่ง','error');
 const pending=deliveredEntries(o).filter(r=>r.deliveryMode==='manual'&&!(r.codes||[]).length);
 if(!pending.length)return toast('ไม่พบรายการรอจัดส่ง','error');
 document.body.insertAdjacentHTML('beforeend',`<div id="editor-modal" class="modal-backdrop"><section class="glass modal order-detail-modal" role="dialog" aria-modal="true"><div class="modal-title"><div><h2>ส่งข้อมูลแบบรอยืนยัน</h2><p>${safe(o.id)}</p></div><button type="button" data-action="close-modal">×</button></div><form class="admin-form" id="manual-delivery-form"><input type="hidden" name="orderId" value="${safe(id)}"><label>เลือกสินค้าที่ต้องส่ง<select class="input" name="productId">${pending.map(i=>`<option value="${safe(i.productId)}">${safe(i.name)} (${i.quantity} ชิ้น)</option>`).join('')}</select></label><label>ข้อมูลสินค้า (จำนวนบรรทัดต้องตรงจำนวนชิ้น)<textarea class="input input-area" name="codes" rows="6" required placeholder="ข้อมูลที่ต้องการส่งให้ลูกค้า&#10;1 บรรทัด = 1 ชิ้น"></textarea></label><button class="btn btn-primary" type="submit">ยืนยันส่งข้อมูล</button></form></section></div>`);
}
async function submitManualDelivery(form){
 if(!state.admin)return;
 const v=new FormData(form),orderId=String(v.get('orderId')||''),pid=String(v.get('productId')||'');
 const codes=String(v.get('codes')||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const o=state.adminOrders.find(o=>o.id===orderId),item=deliveredEntries(o).find(i=>i.productId===pid&&i.deliveryMode==='manual');
 if(!o||o.status!=='processing'||!item||codes.length!==num(item.quantity))return toast('จำนวนข้อมูลต้องตรงกับจำนวนชิ้นที่รอจัดส่ง','error');
 if(codes.some(c=>c.length>300))return toast('ข้อมูลแต่ละบรรทัดต้องไม่เกิน 300 ตัวอักษร','error');
 try{
  await state.F.runTransaction(state.db,async tx=>{
   const r=doc('orders',orderId),d=await tx.get(r);
   if(!d.exists()||d.data().status!=='processing')throw Error('ออเดอร์นี้เปลี่ยนสถานะแล้ว');
   const entries=deliveredEntries(d.data()),current=entries.find(it=>it.productId===pid);
   if(!current||current.deliveryMode!=='manual'||current.codes?.length)throw Error('รายการนี้ส่งไปแล้ว');
   const changed=entries.map(it=>it.productId===pid?{...it,codes}:it);
   const done=changed.every(it=>(it.codes||[]).length===num(it.quantity));
   tx.update(r,{deliveredItems:changed,status:done?'completed':'processing',updatedAt:now()});
  });
  $('#editor-modal')?.remove();await loadOrders(true);render();toast('ส่งข้อมูลให้ลูกค้าสำเร็จ');
 }catch(e){toast('ส่งข้อมูลไม่สำเร็จ: '+errMsg(e),'error')}
}
async function cancelOrder(id){
 if(!state.admin)return;
 const o=state.adminOrders.find(o=>o.id===id);
 if(!o||o.status!=='pending')return;if(!(await askConfirm('ยกเลิกคำสั่งซื้อที่ยังไม่ได้จัดส่งนี้',{title:'ยืนยันยกเลิกออเดอร์',confirmLabel:'ยกเลิกออเดอร์',danger:true})))return;
 try{await state.F.runTransaction(state.db,async tx=>{const r=doc('orders',id),d=await tx.get(r);if(!d.exists()||d.data().status!=='pending')throw Error('ออเดอร์เปลี่ยนสถานะแล้ว');tx.update(r,{status:'cancelled',updatedAt:now()})});await loadOrders(true);render();toast('ยกเลิกออเดอร์แล้ว')}
 catch(e){toast(errMsg(e),'error')}
}

async function saveSettings(form){const v=form.elements;const data={storeName:String(v.storeName.value||'FIX STORE').trim().slice(0,60),announcement:String(state.settings.announcement||'').trim().slice(0,150),supportLink:String(v.supportLink.value||'').trim().slice(0,500),discordUrl:String(v.discordUrl.value||'').trim().slice(0,500),youtubeUrl:String(v.youtubeUrl.value||'').trim().slice(0,500),lineUrl:String(v.lineUrl.value||'').trim().slice(0,500)};if(['supportLink','discordUrl','youtubeUrl','lineUrl'].some(k=>data[k]&&!https(data[k])))return toast('ลิงก์ช่องทางติดต่อต้องเป็น HTTPS ทั้งหมด','error');try{await state.F.setDoc(doc('settings','general'),data);state.settings=data;renderFooter();toast('บันทึกการตั้งค่าสำเร็จ')}catch(e){toast(errMsg(e),'error')}}
// Swap only the featured image; leave stock ribbons, selection and cart state untouched.
document.addEventListener('click',event=>{
 const btn=event.target.closest('button[data-action="product-gallery-image"]');
 if(!btn)return;
 event.preventDefault();
 const gallery=btn.closest('.product-presentation');
 const main=gallery?.querySelector('.detail-visual > img');
 const src=https(btn.dataset.gallerySrc||'');
 if(!gallery||!main||!src)return;
 main.src=src;
 const productName=gallery.closest('.product-spotlight')?.querySelector('.product-purchase-panel h1')?.textContent||'สินค้า';
 main.alt=productName+' — รูป '+(Number(btn.dataset.galleryIndex)+1);
 gallery.querySelectorAll('.product-gallery-thumb').forEach(el=>{
  const active=el===btn;el.classList.toggle('is-active',active);
  el.setAttribute('aria-pressed',String(active));
 });
});
// Single delegated handler: no event listeners are lost when content changes.
document.addEventListener('click',async e=>{const button=e.target.closest('[data-action]');if(!button)return;const {action,id}=button.dataset;if(['toggle-password','new-product','edit-product','close-modal','logout','add-cart','qty','remove','category','refresh-orders','delete-product','delete-stock','new-category','edit-category','delete-category','seed-categories','refresh-admin','new-announcement','edit-announcement','delete-announcement','stock-filter','wallet-select-amount','wallet-method','wallet-refresh','wallet-retry-qr','wallet-open-topup','wallet-amount-close','wallet-amount-preset','wallet-close','wallet-next-step','wallet-prev-step','wallet-checkout','copy-issued-code','codes-close','toggle-discount-box','clear-discount'].includes(action))e.preventDefault();switch(action){case'toggle-password':{const input=$('#'+button.dataset.target);if(input){input.type=input.type==='password'?'text':'password';button.setAttribute('aria-label',input.type==='password'?'แสดงรหัสผ่าน':'ซ่อนรหัสผ่าน')}break}case'category':{state.filter=button.dataset.category;state.search='';location.hash=link('shop');render();break}case'stock-filter':{state.stockFilter=button.dataset.status||'all';render(true);break}case'add-cart':{const qty=num(state.cart.find(x=>x.id===id)?.quantity);await changeCart(id,qty+1);break}case'qty':{const qty=num(state.cart.find(x=>x.id===id)?.quantity);await changeCart(id,qty+num(button.dataset.delta));break}case'remove':await changeCart(id,0);break;case'wallet-checkout':await checkoutWallet();break;case'toggle-discount-box':{state.discountDrawer=!state.discountDrawer;const wrap=button.closest('.cart-promo');const panel=wrap?.querySelector('#cart-promo-panel');wrap?.classList.toggle('is-open',state.discountDrawer);button.setAttribute('aria-expanded',String(state.discountDrawer));button.setAttribute('aria-label',state.discountDrawer?'ปิดช่องกรอกโค้ดส่วนลด':'กรอกโค้ดส่วนลด');button.title=state.discountDrawer?'ปิดช่องกรอกโค้ดส่วนลด':'กรอกโค้ดส่วนลด';if(panel)panel.hidden=!state.discountDrawer;if(state.discountDrawer)panel?.querySelector('input[name=code]')?.focus({preventScroll:true});break;}case'clear-discount':clearDiscountCode();break;case'wallet-select-amount':{state.walletAmount=num(button.dataset.amount);$$('.credit-amount-choice').forEach(el=>el.classList.toggle('active',num(el.dataset.amount)===state.walletAmount));const amount=$('#wallet-intent-form input[name=amount]');if(amount)amount.value=String(state.walletAmount);break}case'wallet-method':go(button.dataset.method==='code'?'wallet-code':'wallet-qr');break;case'wallet-refresh':await loadWallet();break;case'wallet-open-topup':openWalletAmountModal();break;case'wallet-amount-close':closeWalletAmountModal();break;case'wallet-amount-preset':{const n=Number(button.dataset.topupPreset);if(Number.isInteger(n)){state.walletAmount=n;const input=$('#wallet-amount-input');if(input){input.value=String(n);refreshWalletAmountDialog()}}break};case'wallet-retry-qr':await loadWallet(true);break;case'wallet-next-step':{if(walletTimeLeftMs()<=0){toast('QR หมดอายุแล้ว กรุณาสร้างรายการใหม่','error');break;}setWalletModalStep(2);break}case'wallet-prev-step':setWalletModalStep(1);break;case'copy-issued-code':void copyText(button.dataset.value||'');break;case'codes-close':$('#issued-codes-modal')?.remove();break;case'wallet-close':closeWalletModal();break;case'wallet-new-qr':{const amount=num(state.walletIntent?.amountSatang)/100;closeWalletModal();state.walletAmount=amount||100;openWalletAmountModal();break}case'wallet-download-qr':downloadWalletQr();break;case'refresh-users':await loadAdminUsers();break;case'refresh-api':await loadApiMonitor();break;case'copy-history-code':await copyHistoryCode(button.dataset.kind,id);break;case'refresh-code-history':await loadCodeHistory(button.dataset.kind,false);break;case'more-code-history':await loadCodeHistory(button.dataset.kind,true);break;case'manage-user':showUserManager(id);break;case'user-panel-tab':switchUserManagerTab(button.dataset.userTab);break;case'user-finance-refresh':{const uid=$('[data-user-manager-uid]')?.dataset.userManagerUid;if(uid)await loadUserFinancialHistory(uid,false);break}case'user-finance-more':{const uid=$('[data-user-manager-uid]')?.dataset.userManagerUid;if(uid&&userFinancePanel.hasMore)await loadUserFinancialHistory(uid,true);break}case'copy-user-uid':void copyText(id);break;case'logout':{try{await state.A.signOut(state.auth);await setAuthUser(null);toast('ออกจากระบบแล้ว');go('home')}catch(err){toast(errMsg(err),'error')}break}case'refresh-orders':await loadOrders();render();break;case'orders-tab':state.ordersTab=button.dataset.tab||'all';render(true);break;case'view-order':showOrderDetails(id);break;case'claim-order':showClaimModal(id);break;case'admin-claims-tab':state.adminClaimTab=button.dataset.tab==='closed'?'closed':'pending';render(true);void verifyAdminClaimOrders();break;case'edit-claim':showClaimResolutionModal(id);break;case'copy-order':void copyText(id);break;case'copy-code':void copyText(button.dataset.value||'');break;case'copy-all-codes':{const o=getOrder(id);void copyText(deliveredEntries(o).flatMap(it=>it.codes||[]).join('\n'));break}case'approve-order':void approveAndDeliver(id);break;case'manual-delivery':showManualDelivery(id);break;case'cancel-order':void cancelOrder(id);break;case'toggle-bell':{if(!state.soundEnabled){try{claimSound=claimSound||new (window.AudioContext||window.webkitAudioContext)();await claimSound.resume();state.soundEnabled=true;playClaimBell()}catch(e){toast('เปิดเสียงไม่ได้: '+errMsg(e),'error')}}else state.soundEnabled=false;render(true);break}case'new-product':case'edit-product':{if(!state.categories.some(c=>c.active!==false)&&action==='new-product'){toast('ต้องสร้างหมวดหมู่ก่อนเพิ่มสินค้า','error');go('admin-categories');break;}document.body.insertAdjacentHTML('beforeend',editorModal(action==='edit-product'?id:null));setTimeout(()=>$('#product-form input[name="name"]')?.focus(),10);break}case'close-modal':stopFinanceLive();$('#editor-modal')?.remove();if(['orders','admin-claims','admin'].includes(state.current))scheduleLiveUpdate();break;case'new-category':case'edit-category':{document.body.insertAdjacentHTML('beforeend',categoryModal(action==='edit-category'?id:null));$('#category-form input[name="name"]')?.focus();break}case'delete-category':await deleteCategory(id);break;case'seed-categories':await seedCategories();break;case'refresh-admin':await refreshAdmin();break;case'new-announcement':case'edit-announcement':{document.body.insertAdjacentHTML('beforeend',announcementModal(action==='edit-announcement'?id:null));$('#announcement-form input[name="text"]')?.focus();break}case'delete-announcement':await deleteAnnouncement(id);break;case'delete-product':await deleteProduct(id);break;case'delete-stock':await deleteStock(id);break;default:break}});
document.addEventListener('input',e=>{if(e.target.id==='wallet-amount-input'){state.walletAmount=Number(e.target.value);refreshWalletAmountDialog()}if(e.target.id==='category-search'){const term=e.target.value.trim().toLowerCase(),matches=publicCategories().filter(c=>`${c.name||''} ${c.description||''}`.toLowerCase().includes(term)),grid=$('#category-grid');if(grid)grid.innerHTML=matches.length?matches.map(categoryTile).join(''):'<div class="category-empty">ไม่พบหมวดหมู่ที่ค้นหา</div>';const count=$('#category-count');if(count)count.textContent=matches.length+' หมวดหมู่'}if(e.target.id==='admin-user-search'){const q=e.target.value.trim().toLowerCase();let visible=0;$$('[data-user-row]').forEach(row=>{row.hidden=!String(row.dataset.userFilter||'').includes(q);if(!row.hidden)visible++});const empty=$('#admin-users-empty');if(empty)empty.hidden=visible>0;}if(e.target.id==='search-input'){state.search=e.target.value;const pos=e.target.selectionStart;const shopGrid=$('#shop-grid');if(!shopGrid)return;const list=filteredShopProducts(state.filter);shopGrid.innerHTML=list.length?list.map(productCard).join(''):empty('ไม่พบสินค้า','ลองเปลี่ยนคำค้นหาหรือตัวกรอง');$('.shop-count').textContent=`พบสินค้า ${list.length} รายการ`}});
document.addEventListener('dragover',e=>{const zone=e.target.closest?.('.wallet-upload-zone');if(!zone)return;e.preventDefault();zone.classList.add('fx-v89-drag-over')});
document.addEventListener('dragleave',e=>{const zone=e.target.closest?.('.wallet-upload-zone');if(zone&&!zone.contains(e.relatedTarget))zone.classList.remove('fx-v89-drag-over')});
document.addEventListener('drop',e=>{const zone=e.target.closest?.('.wallet-upload-zone');if(!zone)return;e.preventDefault();zone.classList.remove('fx-v89-drag-over');const input=$('#wallet-slip-input');if(!input||input.disabled)return;const file=e.dataTransfer?.files?.[0];if(!file)return;try{const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;updateWalletSlipFile(input)}catch{toast('เลือกสลิปผ่านปุ่มเลือกไฟล์เพื่ออัปโหลด','info')}});
document.addEventListener('change',async e=>{if(e.target.name==='expiresUnit'&&e.target.closest('#admin-topup-code-form')){const input=e.target.closest('form').querySelector('input[name=expiresValue]');if(input){input.max=e.target.value==='hours'?'8760':'365';if(Number(input.value)>Number(input.max))input.value=input.max;}}if(e.target.name==='source'&&e.target.closest('#claim-resolve-form')){const f=e.target.closest('form');const source=e.target.value;const manual=f.querySelector('.claim-resolve-manual');const note=f.querySelector('.claim-resolve-stock-note');const refund=f.querySelector('.claim-resolve-refund-note');manual.hidden=source!=='manual';note.hidden=source!=='stock';refund.hidden=source!=='refund';manual.querySelector('textarea').required=source==='manual';const submit=f.querySelector('.claim-resolve-submit');if(submit)submit.textContent=source==='refund'?'คืนเครดิตและยกเลิกออเดอร์':'ยืนยันส่งข้อมูลและจบเคลม';}if(e.target.id==='wallet-slip-input')updateWalletSlipFile(e.target);if(e.target.id==='sort-input'){state.sort=e.target.value;render()}else if(e.target.id==='stock-product'){await loadStock(e.target.value);render()}else if(e.target.dataset.claimStatus)await updateClaimStatus(e.target.dataset.claimStatus,e.target.value)});
document.addEventListener('submit',async e=>{const id=e.target.getAttribute('id');if(!['auth-form','product-form','stock-form','settings-form','category-form','announcement-form','claim-form','claim-resolve-form','manual-delivery-form','wallet-intent-form','wallet-slip-form','redeem-code-form','admin-topup-code-form','admin-discount-code-form','discount-form','admin-credit-form','admin-reset-password-form'].includes(id))return;e.preventDefault();if(id==='auth-form')await submitAuth(e.target);else if(id==='product-form')await saveProduct(e.target);else if(id==='stock-form')await saveStock(e.target);else if(id==='settings-form')await saveSettings(e.target);else if(id==='category-form')await saveCategory(e.target);else if(id==='announcement-form')await saveAnnouncement(e.target);else if(id==='claim-form')await submitClaim(e.target);else if(id==='claim-resolve-form')await submitClaimResolution(e.target);else if(id==='manual-delivery-form')await submitManualDelivery(e.target);else if(id==='wallet-intent-form')await createWalletIntent(e.target);else if(id==='wallet-slip-form')await verifyWalletSlip(e.target);else if(id==='redeem-code-form')await redeemTopupCode(e.target);else if(id==='discount-form')await applyDiscountCode(e.target);else if(id==='admin-topup-code-form')await createAdminTopupCodes(e.target);else if(id==='admin-discount-code-form')await createAdminDiscountCodes(e.target);else if(id==='admin-credit-form')await submitAdminCredit(e.target);else if(id==='admin-reset-password-form')await submitAdminPassword(e.target)});
document.addEventListener('focusin',e=>{if(e.target.matches('input,textarea,select'))document.body.classList.add('mobile-keyboard-active')});
document.addEventListener('focusout',e=>{if(e.target.matches('input,textarea,select'))document.body.classList.remove('mobile-keyboard-active')});
$('#mobile-nav').addEventListener('click',e=>{if(e.target.closest('a,button[data-action]'))closeMobileAccountMenu()});
$('#mobile-menu-toggle').addEventListener('click',()=>{
 const menu=$('#mobile-nav'),toggle=$('#mobile-menu-toggle');
 if(menu.hidden)syncMobileAccountMenu();
 menu.hidden=!menu.hidden;
 toggle.setAttribute('aria-expanded',String(!menu.hidden));
 toggle.setAttribute('aria-label',menu.hidden?'เปิดเมนูเพิ่มเติม':'ปิดเมนูเพิ่มเติม');
});
document.addEventListener('pointerdown',e=>{
 if($('#mobile-nav')?.hidden)return;
 if(e.target.closest('#mobile-nav,#mobile-menu-toggle'))return;
 closeMobileAccountMenu();
});
window.addEventListener('resize',()=>closeMobileAccountMenu());
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('#editor-modal .user-control-v88'))stopFinanceLive();$('#editor-modal')?.remove();if(state.current==='orders')scheduleLiveUpdate();closeWalletModal();closeWalletAmountModal();$('#issued-codes-modal')?.remove();closeMobileAccountMenu({restoreFocus:true})}});
window.addEventListener('hashchange',async()=>{if($('#wallet-modal'))closeWalletModal();closeWalletAmountModal();const path=route().path;if(path==='shop'&&route().params.has('category'))state.filter=route().params.get('category');if(path==='orders'&&state.user)await loadOrders();if(['wallet','wallet-qr','wallet-code','account'].includes(path)&&state.user)void loadWallet();if(admPages[path]&&state.admin)await adminLoad(path);render()});
// Hash route changes are view changes (not scroll anchors), including on file://.
// route() defaults to home when the URL has no hash.
try{render();void init()}catch(error){
 console.error('[FIX STORE] Startup error:',error);
 const host=document.querySelector('#app');
 if(host)host.innerHTML='<section class="page-in glass" style="max-width:620px;margin:40px auto;padding:25px;text-align:center;border-radius:16px"><h1 style="font-size:22px">เว็บไซต์ไม่สามารถเริ่มทำงานได้</h1><p style="color:#aeb4bf;line-height:1.7">ตรวจพบข้อผิดพลาดระหว่างเริ่มหน้าเว็บ กรุณารีเฟรช หากยังเกิดปัญหาโปรดติดต่อผู้ดูแลและเปิด Console เพื่อตรวจรายละเอียด</p><button class="btn btn-primary" type="button" onclick="location.reload()">โหลดหน้าเว็บอีกครั้ง</button></section>';
}
})();
