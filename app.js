const API = '';
let token = localStorage.getItem('token') || '';
let me = null;
let settings = {};
let tab = 'services';
let services = [], rentals = [], deposits = [], users = [], adminRentals = [], adminDeposits = [], notifications = [], dmxProducts = [], dmxOrders = [];
let otpPollTimer = null;
let otpPollBusy = false;
let otpPollCursor = 0;
let descPollTimer = null;
let descPollBusy = false;

const $ = s => document.querySelector(s);
const app = $('#app');
const fmt = n => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const date = s => s ? new Date(s).toLocaleString('vi-VN') : '';
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
async function api(path, opts={}){
  opts.headers = opts.headers || {};
  if (!(opts.body instanceof FormData)) opts.headers['Content-Type'] = 'application/json';
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Có lỗi xảy ra');
  return data;
}
function toast(msg, ok=true){
  const n = document.createElement('div');
  n.className = 'notice ' + (ok?'okbox':'err');
  n.textContent = msg;
  const main = $('.main') || app;
  main.prepend(n);
  setTimeout(()=>n.remove(),3500);
}
function safeCopyValue(v){ return String(v ?? '').trim(); }
async function copyText(v, label='Nội dung'){
  const text = safeCopyValue(v);
  if(!text || text === 'Chưa có'){ toast('Chưa có '+label.toLowerCase()+' để copy', false); return; }
  try{
    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
    }else{
      const ta=document.createElement('textarea');
      ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.left='-9999px';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('Đã copy '+label+': '+text);
  }catch(e){ toast('Không copy được, hãy bôi đen và copy thủ công', false); }
}
function copyElementText(id, label='Nội dung'){
  const el = document.getElementById(id);
  copyText(el ? el.textContent : '', label);
}
function setTextIfChanged(id, text){
  const el = document.getElementById(id);
  if(el && el.textContent !== String(text || '')) el.textContent = String(text || '');
}
function sortRentalsNewest(rows){ return [...rows].sort((a,b)=>new Date(b.rented_at||0)-new Date(a.rented_at||0)); }
async function loadSettings(){ settings = await api('/api/settings'); document.documentElement.style.setProperty('--brand', settings.themeColor || '#2563eb'); document.body.classList.toggle('layout-compact', settings.layoutMode === 'compact'); }
async function loadMe(){ if(!token) return; try{ const d = await api('/api/me'); me = d.user; }catch(e){ token=''; localStorage.removeItem('token'); me=null; } }
async function boot(){ await loadSettings(); await loadMe(); if(!me) renderAuth(); else await loadPage(); }
function header(){
  return `<div class="top"><div class="wrap topin"><div class="brand">${settings.logoUrl?`<img class="logo" src="${esc(settings.logoUrl)}">`:`<div class="logo"></div>`}<div><h1>${esc(settings.siteName||'Có All Dịch Vụ')}</h1><p>${esc(settings.brandText||'')}</p></div></div><div class="userbar"><span class="pill">${esc(me.username)} ${me.role==='admin'?'• Admin':''}</span><span class="pill">Số dư: <b>${fmt(me.balance)}</b></span><button class="secondary" onclick="logout()">Đăng xuất</button></div></div></div>`;
}
function menu(){
  const common = [['services','Dịch vụ'],['dmx','Dịch Vụ DMX'],['history','Lịch sử'],['deposit','Nạp tiền']];
  const admin = [['admin_services','Dịch vụ admin'],['admin_dmx','Quản lý DMX'],['admin_api','API thuê sim'],['admin_history','Lịch sử admin'],['admin_deposit_info','Nạp tiền admin'],['admin_users','Quản lý người dùng'],['admin_web','Quản lý web'],['admin_approve','Duyệt nạp tiền']];
  const items = me.role==='admin' ? common.concat(admin) : common;
  return `<div class="side">${items.map(i=>`<button class="tab ${tab===i[0]?'active':''}" onclick="setTab('${i[0]}')">${i[1]}${i[0]==='admin_approve'&&notifications.filter(n=>!n.read).length?` (${notifications.filter(n=>!n.read).length})`:''}</button>`).join('')}</div>`;
}
async function loadPage(){
  await loadSettings();
  if(me?.role==='admin') notifications = await api('/api/admin/notifications').catch(()=>[]);
  app.innerHTML = header()+`<div class="wrap grid">${menu()}<div class="main"></div></div>`;
  if(settings.adUrl) $('.main').insertAdjacentHTML('beforeend', `<img class="ad" src="${esc(settings.adUrl)}">`);
  await renderTab();
  startOtpAutoPolling();
  startLiveDescriptionPolling();
}
async function setTab(t){ tab=t; await loadPage(); }
function logout(){ stopOtpAutoPolling(); stopLiveDescriptionPolling(); localStorage.removeItem('token'); token=''; me=null; renderAuth(); }
function renderAuth(){
  app.innerHTML = `<div class="wrap auth card"><h2>${esc(settings.siteName||'Có All Dịch Vụ')}</h2><div id="msg"></div><div class="field"><label>Tài khoản</label><input id="username" placeholder="Nhập tài khoản"></div><div class="field"><label>Mật khẩu</label><input id="password" type="password" placeholder="Nhập mật khẩu"></div><div class="flex"><button onclick="login()">Đăng nhập</button><button class="secondary" onclick="register()">Đăng ký user</button></div></div>`;
}
async function login(){ try{ const d=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})}); token=d.token; localStorage.setItem('token',token); me=d.user; tab='services'; await loadPage(); }catch(e){ $('#msg').innerHTML=`<div class="notice err">${esc(e.message)}</div>`; } }
async function register(){ try{ const d=await api('/api/register',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})}); token=d.token; localStorage.setItem('token',token); me=d.user; tab='services'; await loadPage(); }catch(e){ $('#msg').innerHTML=`<div class="notice err">${esc(e.message)}</div>`; } }
async function renderTab(){
  if(tab==='services') return userServices();
  if(tab==='dmx') return userDmx();
  if(tab==='history') return userHistory();
  if(tab==='deposit') return userDeposit();
  if(tab==='admin_services') return adminServices();
  if(tab==='admin_dmx') return adminDmx();
  if(tab==='admin_api') return adminApi();
  if(tab==='admin_history') return adminHistory();
  if(tab==='admin_deposit_info') return adminDepositInfo();
  if(tab==='admin_users') return adminUsers();
  if(tab==='admin_web') return adminWeb();
  if(tab==='admin_approve') return adminApprove();
}
async function userServices(){
  services = await api('/api/services');
  $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Dịch vụ thuê sim</h2><div class="servicegrid">${services.map(s=>`<div class="svc">${s.imageUrl?`<img class="svc-img" src="${esc(s.imageUrl)}">`:''}<h3>${esc(s.name)}</h3><div class="desc-box"><p id="svc_desc_${s.id}" class="muted live-desc">${esc(s.description||'')}</p><button class="small secondary copy-desc-btn" onclick="copyElementText('svc_desc_${s.id}','mô tả')">Copy mô tả</button></div><div class="field"><label>Nhà mạng</label><select id="carrier_${s.id}">${carrierOptions(s.network)}</select></div><div class="price">${fmt(s.price)}</div><button onclick="rent('${s.id}')">Thuê sim</button></div>`).join('')}</div></div><div class="card"><h2>Sim đang thuê</h2><div id="activeRentals"></div></div><div class="card"><h2>Lịch sử thuê sim</h2><p class="muted">Số thuê mới nhất nằm trên cùng, số thuê cũ hơn nằm bên dưới.</p><div id="serviceRentalHistory"></div></div>`);
  rentals = await api('/api/rentals');
  $('#activeRentals').innerHTML = tableRentals(sortRentalsNewest(rentals.filter(isActiveRental)));
  $('#serviceRentalHistory').innerHTML = tableRentals(sortRentalsNewest(rentals.filter(showInHistoryRental)));
}
function carrierOptions(network){ const raw=String(network||'').trim(); if(!raw) return '<option value="">Tự động</option>'; const arr=raw.split(/[,;\n]/).map(x=>x.trim()).filter(Boolean); return ['<option value="">Tự động</option>'].concat(arr.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`)).join(''); }
async function rent(id){
  try{
    const el=$('#carrier_'+id);
    const d=await api('/api/rentals',{method:'POST',body:JSON.stringify({service_id:id,carrier:el?el.value:''})});
    me=d.user;
    toast('Thuê sim thành công: '+d.rental.phone_number+'. Hệ thống sẽ tự lấy OTP, không cần bấm Lấy code.');
    await loadMe();
    await loadPage();
    startOtpAutoPolling(true);
  }catch(e){ toast(e.message,false); }
}
async function checkCode(id, silent=false){
  try{
    const d=await api('/api/rentals/'+id+'/check-code',{method:'POST',body:JSON.stringify({})});
    const msg=d.api?.message || d.api?.Msg || 'Đã kiểm tra code';
    if(!silent || d.rental?.otp_code || d.rental?.refunded) toast(msg + (d.rental?.otp_code?(': '+d.rental.otp_code):''));
    if(!silent) await loadPage();
    return d;
  }catch(e){ if(!silent) toast(e.message,false); throw e; }
}
async function cancelRental(id){ if(!confirm('Hủy lượt thuê này?')) return; try{ const d=await api('/api/rentals/'+id+'/cancel',{method:'POST',body:JSON.stringify({})}); toast(d.api?.message || d.api?.Msg || 'Đã gửi yêu cầu hủy'); await loadPage(); }catch(e){ toast(e.message,false); } }
function isWaitingOtp(r){ return r && r.external_id && !r.otp_code && !r.refunded && String(r.status||'').toLowerCase().includes('chờ'); }
function justReceivedOtp(r){ return !!(r && r.otp_code && r.ended_at && (Date.now() - new Date(r.ended_at).getTime()) < 120000); }
function isActiveRental(r){ return isWaitingOtp(r) || String(r.status||'')==='Đang thuê' || justReceivedOtp(r); }
function showInHistoryRental(r){ return !justReceivedOtp(r); }
function stopOtpAutoPolling(){ if(otpPollTimer){ clearInterval(otpPollTimer); otpPollTimer=null; } }
function startOtpAutoPolling(runNow=false){
  stopOtpAutoPolling();
  if(!token || !me) return;
  // CodeSim khuyến nghị không gọi quá nhanh; 8 giây/lần an toàn hơn mốc 4 giây.
  otpPollTimer = setInterval(autoCheckOtpOnce, 8000);
  if(runNow) setTimeout(autoCheckOtpOnce, 1200);
}
async function autoCheckOtpOnce(){
  if(otpPollBusy || !token || !me) return;
  otpPollBusy = true;
  try{
    const rows = await api('/api/rentals');
    const waiting = rows.filter(isWaitingOtp);
    if(!waiting.length){ stopOtpAutoPolling(); return; }
    const r = waiting[otpPollCursor % waiting.length];
    otpPollCursor++;
    const d = await checkCode(r.id, true).catch(()=>null);
    const updatedRows = await api('/api/rentals').catch(()=>rows);
    const active = sortRentalsNewest(updatedRows.filter(isActiveRental));
    if($('#activeRentals')) $('#activeRentals').innerHTML = tableRentals(active);
    if($('#serviceRentalHistory')) $('#serviceRentalHistory').innerHTML = tableRentals(sortRentalsNewest(updatedRows.filter(showInHistoryRental)));
    if(d?.rental?.otp_code){ toast('Đã nhận OTP cho số '+(d.rental.phone_number||'')+': '+d.rental.otp_code); }
    if(d?.rental?.refunded){ await loadMe(); me = (await api('/api/me')).user; toast(d.rental.note || 'Đã tự hoàn tiền vì hết thời gian chờ OTP'); }
  }catch(e){
    // Không spam lỗi trong quá trình tự kiểm tra; người dùng vẫn có thể bấm kiểm tra thủ công.
  }finally{ otpPollBusy = false; }
}
function stopLiveDescriptionPolling(){ if(descPollTimer){ clearInterval(descPollTimer); descPollTimer=null; } }
function startLiveDescriptionPolling(runNow=false){
  stopLiveDescriptionPolling();
  if(!token || !me || !['services','dmx'].includes(tab)) return;
  descPollTimer = setInterval(refreshLiveDescriptionsOnce, 8000);
  if(runNow) setTimeout(refreshLiveDescriptionsOnce, 1200);
}
async function refreshLiveDescriptionsOnce(){
  if(descPollBusy || !token || !me || !['services','dmx'].includes(tab)) return;
  descPollBusy = true;
  try{
    if(tab === 'services'){
      const rows = await api('/api/services');
      services = rows;
      rows.forEach(s => setTextIfChanged('svc_desc_'+s.id, s.description || ''));
    }else if(tab === 'dmx'){
      const rows = await api('/api/dmx/products');
      dmxProducts = rows;
      rows.forEach(p => setTextIfChanged('dmx_desc_'+p.id, p.description || ''));
    }
  }catch(e){
    // Không hiện lỗi để tránh làm phiền khách khi đang xem trang.
  }finally{ descPollBusy = false; }
}
function tableRentals(rows){ if(!rows.length) return '<p class="muted">Chưa có dữ liệu.</p>'; return `<div class="tablewrap"><table class="table"><tr><th>Số sim</th><th>OTP/SMS</th><th>Dịch vụ</th><th>Nhà mạng</th><th>Giá</th><th>Trạng thái</th><th>Thời gian</th><th>Thao tác</th></tr>${rows.map(r=>{ const phone=esc(r.phone_number||''); const otp=esc(r.otp_code||'Chưa có'); return `<tr><td><div class="copy-cell"><b>${phone}</b><button class="small secondary copy-btn" onclick="copyText('${phone}','SĐT')">Copy SĐT</button></div></td><td><div class="copy-cell"><b>${otp}</b><button class="small secondary copy-btn" onclick="copyText('${otp}','OTP')">Copy OTP</button></div><small>${esc(r.sms||'')}</small></td><td>${esc(r.service_name)}</td><td>${esc(r.network)}</td><td>${fmt(r.price)}</td><td><span class="badge">${esc(r.status)}</span><br><small>${esc(r.note||'')}</small>${isWaitingOtp(r)?'<br><small class="muted">Đang tự động lấy OTP mỗi 8 giây, không tải lại trang.</small>':justReceivedOtp(r)?'<br><small class="muted">OTP sẽ nằm ở đây 2 phút trước khi chuyển vào lịch sử.</small>':''}</td><td>${date(r.rented_at)}</td><td>${r.external_id&&isWaitingOtp(r)?`<button class="small ok" onclick="checkCode('${r.id}')">Kiểm tra ngay</button>`:''} ${r.service_id?`<button class="small" onclick="rent('${r.service_id}')">Thuê lại</button>`:''}</td></tr>` }).join('')}</table></div>`; }
async function userHistory(){ rentals=await api('/api/rentals'); dmxOrders=await api('/api/dmx/orders').catch(()=>[]); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Lịch sử thuê sim</h2>${tableRentals(sortRentalsNewest(rentals.filter(showInHistoryRental)))}</div><div class="card"><h2>Lịch sử mua DMX</h2>${tableDmxOrders(dmxOrders,false)}</div>`); }

async function userDmx(){
  dmxProducts = await api('/api/dmx/products');
  const cats = [...new Set(dmxProducts.map(p=>p.category).filter(Boolean))].sort();
  $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Dịch Vụ DMX</h2><div class="row"><div class="field"><label>Tìm kiếm sản phẩm</label><input id="dmxSearch" placeholder="Nhập tên sản phẩm" oninput="renderDmxProducts()"></div><div class="field"><label>Lọc phân loại</label><select id="dmxCategory" onchange="renderDmxProducts()"><option value="">Tất cả phân loại</option>${cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div></div><div id="dmxProductList"></div></div>`);
  renderDmxProducts();
}
function dmxUnitPrice(p, qty){ qty=Math.max(1,Number(qty||1)); const min=Number(p.bulkMinQty||0), bulk=Number(p.bulkPrice||0), price=Number(p.price||0); return min>0&&bulk>0&&qty>=min?bulk:price; }
function renderDmxProducts(){
  const q=($('#dmxSearch')?.value||'').toLowerCase().trim();
  const cat=$('#dmxCategory')?.value||'';
  const rows=dmxProducts.filter(p=>(!q||[p.name,p.category,p.description].join(' ').toLowerCase().includes(q))&&(!cat||p.category===cat));
  $('#dmxProductList').innerHTML = rows.length ? `<div class="servicegrid">${rows.map(p=>`<div class="svc">${p.imageUrl?`<img class="svc-img" src="${esc(p.imageUrl)}">`:''}<h3>${esc(p.name)}</h3><p class="muted">${esc(p.category||'Chưa phân loại')}</p><div class="desc-box"><p id="dmx_desc_${p.id}" class="live-desc">${esc(p.description||'')}</p><button class="small secondary copy-desc-btn" onclick="copyElementText('dmx_desc_${p.id}','mô tả')">Copy mô tả</button></div><div class="price">${fmt(p.price)}</div>${p.bulkMinQty&&p.bulkPrice?`<p class="muted">Mua từ ${p.bulkMinQty}: ${fmt(p.bulkPrice)}/sp</p>`:''}<div class="field"><label>Số lượng</label><input id="dmxQty_${p.id}" type="number" min="1" value="1" oninput="updateDmxTotal('${p.id}')"></div><p id="dmxTotal_${p.id}" class="notice">Tổng: ${fmt(p.price)}</p><button onclick="buyDmx('${p.id}')">Mua sản phẩm</button></div>`).join('')}</div>` : '<p class="muted">Không tìm thấy sản phẩm.</p>';
  rows.forEach(p=>updateDmxTotal(p.id));
}
function updateDmxTotal(id){ const p=dmxProducts.find(x=>x.id===id); if(!p||!$('#dmxTotal_'+id)) return; const q=Math.max(1,Number($('#dmxQty_'+id)?.value||1)); $('#dmxTotal_'+id).textContent='Tổng: '+fmt(dmxUnitPrice(p,q)*q); }
async function buyDmx(id){
  const p=dmxProducts.find(x=>x.id===id); const q=Math.max(1,Number($('#dmxQty_'+id)?.value||1));
  if(!confirm(`Mua ${q} x ${p?.name||'sản phẩm'}?`)) return;
  try{ const d=await api('/api/dmx/orders',{method:'POST',body:JSON.stringify({product_id:id,quantity:q})}); me=d.user; toast('Mua hàng thành công'); if(d.order?.voucherCodes?.length){ alert('Mã voucher của bạn:\n' + d.order.voucherCodes.join('\\n')); } await loadMe(); tab='history'; await loadPage(); }catch(e){ toast(e.message,false); }
}
async function userDmxHistory(){ dmxOrders=await api('/api/dmx/orders'); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Lịch sử mua DMX</h2>${tableDmxOrders(dmxOrders,false)}</div>`); }
function tableDmxOrders(rows, admin=false){ if(!rows.length) return '<p class="muted">Chưa có đơn hàng DMX.</p>'; return `<div class="tablewrap"><table class="table"><tr>${admin?'<th>User</th>':''}<th>Ngày mua</th><th>Sản phẩm</th><th>Phân loại</th><th>Số lượng</th><th>Đơn giá</th><th>Tổng tiền</th><th>Mã voucher</th><th>Trạng thái</th></tr>${rows.map(o=>`<tr>${admin?`<td>${esc(o.username||'')}</td>`:''}<td>${date(o.created_at)}</td><td>${o.imageUrl?`<img class="thumb" src="${esc(o.imageUrl)}">`:''}${esc(o.product_name)}</td><td>${esc(o.category||'')}</td><td>${o.quantity}</td><td>${fmt(o.unit_price)}</td><td><b>${fmt(o.total)}</b></td><td><pre class="codebox">${esc((o.voucherCodes||[]).join('\n') || '')}</pre></td><td>${esc(o.status||'')}</td></tr>`).join('')}</table></div>`; }
async function adminDmx(){
  dmxProducts = await api('/api/dmx/products');
  $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Quản lý Dịch Vụ DMX</h2><div class="row3"><div class="field"><label>Tên sản phẩm</label><input id="dmxName"></div><div class="field"><label>Phân loại</label><input id="dmxCat" placeholder="VD: Tài khoản, Buff, Tool"></div><div class="field"><label>Giá tiền</label><input id="dmxPrice" type="number"></div></div><div class="row"><div class="field"><label>Mua từ số lượng</label><input id="dmxBulkMin" type="number" placeholder="VD: 10"></div><div class="field"><label>Giá giảm / sản phẩm</label><input id="dmxBulkPrice" type="number" placeholder="VD: 8000"></div></div><div class="field"><label>Mô tả</label><input id="dmxDesc"></div><div class="field"><label>Kho voucher / code sản phẩm</label><textarea id="dmxStockCodes" placeholder="Mỗi dòng là 1 mã/code sản phẩm"></textarea><small class="muted">Khi khách mua, hệ thống tự xuất code theo số lượng và trừ khỏi kho.</small></div><div class="field"><label>Ảnh sản phẩm</label><input id="dmxImage" type="file" accept="image/*"></div><button onclick="addDmxProduct()">Thêm sản phẩm DMX</button></div><div class="card"><h3>Danh sách sản phẩm DMX</h3><div class="row"><div class="field"><label>Tìm kiếm</label><input id="adminDmxSearch" oninput="renderAdminDmxTable()" placeholder="Tên, phân loại"></div><div class="field"><label>Lọc phân loại</label><input id="adminDmxCat" oninput="renderAdminDmxTable()" placeholder="Nhập phân loại"></div></div><div id="adminDmxTable">${tableAdminDmx(dmxProducts)}</div></div>`);
}
function renderAdminDmxTable(){ const q=($('#adminDmxSearch')?.value||'').toLowerCase().trim(); const cat=($('#adminDmxCat')?.value||'').toLowerCase().trim(); const rows=dmxProducts.filter(p=>(!q||[p.name,p.category,p.description].join(' ').toLowerCase().includes(q))&&(!cat||String(p.category||'').toLowerCase().includes(cat))); $('#adminDmxTable').innerHTML=tableAdminDmx(rows); }
function tableAdminDmx(rows){ if(!rows.length) return '<p class="muted">Chưa có sản phẩm DMX.</p>'; return `<div class="admin-service-list">${rows.map(p=>`<div class="admin-service-card"><div class="admin-service-grid"><div><label>Tên</label><input id="dmxn_${p.id}" value="${esc(p.name)}"></div><div><label>Phân loại</label><input id="dmxc_${p.id}" value="${esc(p.category||'')}"></div><div><label>Giá</label><input id="dmxp_${p.id}" type="number" value="${p.price||0}"></div><div><label>Từ SL</label><input id="dmxmin_${p.id}" type="number" value="${p.bulkMinQty||0}"></div><div><label>Giá giảm</label><input id="dmxbulk_${p.id}" type="number" value="${p.bulkPrice||0}"></div><div><label>Ảnh</label>${p.imageUrl?`<a href="${esc(p.imageUrl)}" target="_blank">Xem ảnh</a>`:'<span class="muted">Chưa có</span>'}<input id="dmximg_${p.id}" type="hidden" value="${esc(p.imageUrl||'')}"><input id="dmxfile_${p.id}" type="file" accept="image/*"></div><div><label>Hiển thị</label><div class="toggle-line"><input id="dmxv_${p.id}" type="checkbox" ${p.visible?'checked':''}><span>${p.visible?'Đang hiện':'Đang ẩn'}</span></div><small class="muted">Tồn kho: ${(p.stockCodes||[]).length}</small></div><div class="wide"><label>Mô tả</label><input id="dmxd_${p.id}" value="${esc(p.description||'')}"></div><div class="wide"><label>Thêm code vào kho (mỗi dòng 1 mã)</label><textarea id="dmxstock_${p.id}" placeholder="Dán code mới ở đây, hệ thống sẽ thêm vào kho"></textarea></div><div class="admin-actions"><button class="small" onclick="saveDmxProduct('${p.id}')">Lưu</button><button class="small danger" onclick="deleteDmxProduct('${p.id}')">Xóa</button></div></div></div>`).join('')}</div>`; }
async function addDmxProduct(){ try{ let imageUrl=''; if($('#dmxImage')?.files[0]) imageUrl=await uploadFile($('#dmxImage')); await api('/api/admin/dmx/products',{method:'POST',body:JSON.stringify({name:$('#dmxName').value,category:$('#dmxCat').value,price:$('#dmxPrice').value,bulkMinQty:$('#dmxBulkMin').value,bulkPrice:$('#dmxBulkPrice').value,description:$('#dmxDesc').value,imageUrl,stockText:$('#dmxStockCodes').value,visible:false})}); toast('Đã thêm sản phẩm DMX'); await loadPage(); }catch(e){ toast(e.message,false); } }
async function saveDmxProduct(id){ let imageUrl=$('#dmximg_'+id)?.value||''; if($('#dmxfile_'+id)?.files[0]) imageUrl=await uploadFile($('#dmxfile_'+id)); await api('/api/admin/dmx/products/'+id,{method:'PATCH',body:JSON.stringify({name:$('#dmxn_'+id).value,category:$('#dmxc_'+id).value,price:$('#dmxp_'+id).value,bulkMinQty:$('#dmxmin_'+id).value,bulkPrice:$('#dmxbulk_'+id).value,description:$('#dmxd_'+id).value,imageUrl,stockText:$('#dmxstock_'+id)?.value||'',visible:$('#dmxv_'+id).checked})}); toast('Đã lưu sản phẩm DMX'); dmxProducts=await api('/api/dmx/products'); renderAdminDmxTable(); }
async function deleteDmxProduct(id){ if(!confirm('Xóa sản phẩm DMX này?')) return; await api('/api/admin/dmx/products/'+id,{method:'DELETE'}); toast('Đã xóa sản phẩm'); dmxProducts=await api('/api/dmx/products'); renderAdminDmxTable(); }
async function adminDmxOrders(){ const d=await api('/api/admin/dmx/orders'); const rows=d.rows||[]; $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Đơn hàng DMX</h2><div class="stats"><span class="pill">Tổng đơn: <b>${d.stats?.totalOrders||0}</b></span><span class="pill">Doanh thu: <b>${fmt(d.stats?.revenue||0)}</b></span></div><div class="row"><div class="field"><label>Tìm đơn theo user/sản phẩm</label><input id="dmxOrderSearch" oninput="renderAdminDmxOrders()" placeholder="username, sản phẩm, phân loại"></div><div class="field"><label>Lọc theo ngày</label><input id="dmxOrderDate" type="date" onchange="renderAdminDmxOrders()"></div></div><div id="dmxOrderTable"></div></div>`); window._adminDmxOrders=rows; renderAdminDmxOrders(); }
function renderAdminDmxOrders(){ const rows=window._adminDmxOrders||[]; const q=($('#dmxOrderSearch')?.value||'').toLowerCase().trim(); const day=$('#dmxOrderDate')?.value||''; const filtered=rows.filter(o=>(!q||[o.username,o.product_name,o.category].join(' ').toLowerCase().includes(q))&&(!day||String(o.created_at||'').slice(0,10)===day)); $('#dmxOrderTable').innerHTML=tableDmxOrders(filtered,true); }

async function userDeposit(){
  deposits=await api('/api/deposits');
  $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Nạp tiền tự động SePay</h2><p class="muted">Nhập số tiền, tạo QR, chuyển khoản đúng số tiền và đúng nội dung. Hệ thống sẽ tự cộng tiền khi SePay gửi webhook.</p><div class="row"><div class="field"><label>Số tiền muốn nạp</label><input id="autoDepAmount" type="number" min="1000" step="1000" placeholder="VD: 50000"></div><div class="field"><label>Ngân hàng nhận</label><input disabled value="${esc(settings.sepayBankCode||'MB')} - ${esc(settings.sepayAccount||'')}"></div></div><button onclick="createSepayDeposit()">Tạo QR nạp tự động</button><div id="sepayBox"></div></div><div class="card"><h2>Nạp thủ công / dự phòng</h2><div class="row"><div><div class="notice">${esc(settings.depositInfo||'')}</div>${settings.qrImage?`<img class="qr" src="${esc(settings.qrImage)}">`:''}</div><form onsubmit="sendDeposit(event)"><div class="field"><label>Số tiền đã nạp</label><input id="depAmount" type="number" min="1000" required></div><div class="field"><label>Nội dung chuyển khoản</label><input id="depContent" placeholder="VD: nap ${esc(me.username)}"></div><div class="field"><label>Ảnh bill/chứng từ</label><input id="depProof" type="file" accept="image/*"></div><button>Gửi yêu cầu nạp thủ công</button></form></div></div><div class="card"><h2>Lịch sử nạp</h2>${tableDeposits(deposits)}</div>`);
}
async function createSepayDeposit(){
  const amount = Math.floor(Number($('#autoDepAmount')?.value || 0));
  if(amount < 1000) return toast('Số tiền nạp tối thiểu 1.000đ', false);
  try{
    const d = await api('/api/deposits/auto',{method:'POST',body:JSON.stringify({amount})});
    $('#sepayBox').innerHTML = `<div class="notice okbox" style="margin-top:12px"><b>Chuyển khoản đúng nội dung:</b><br><code>${esc(d.transferContent)}</code><br><b>Số tiền:</b> ${fmt(d.deposit.amount)}<br><b>Tài khoản:</b> ${esc(d.bank)} - ${esc(d.account)} - ${esc(d.accountName||'')}</div>${d.qrUrl?`<img class="qr" src="${esc(d.qrUrl)}">`:''}<p class="muted">Sau khi chuyển khoản, chờ vài giây rồi bấm tải lại lịch sử nếu số dư chưa cập nhật.</p>`;
    await loadMe(); deposits=await api('/api/deposits');
  }catch(e){ toast(e.message,false); }
}
function tableDeposits(rows){ if(!rows.length) return '<p class="muted">Chưa có yêu cầu nạp.</p>'; return `<div class="tablewrap"><table class="table"><tr><th>Số tiền</th><th>Nội dung</th><th>Trạng thái</th><th>Phương thức</th><th>Ảnh/QR</th><th>Ngày gửi</th><th>Ghi chú admin</th></tr>${rows.map(d=>`<tr><td>${fmt(d.amount)}</td><td>${esc(d.content||'')}</td><td><span class="badge ${d.status==='Đã duyệt'?'status-ok':d.status==='Từ chối'?'status-no':'status-wait'}">${esc(d.status)}</span></td><td>${esc(d.method||'thủ công')}</td><td>${d.proof_image?`<a href="${esc(d.proof_image)}" target="_blank">Xem ảnh</a>`:d.sepay_qr?`<a href="${esc(d.sepay_qr)}" target="_blank">QR</a>`:''}</td><td>${date(d.created_at)}</td><td>${esc(d.admin_note||'')}</td></tr>`).join('')}</table></div>`; }
async function sendDeposit(e){ e.preventDefault(); const fd=new FormData(); fd.append('amount',$('#depAmount').value); fd.append('content',$('#depContent').value); if($('#depProof').files[0]) fd.append('proof',$('#depProof').files[0]); try{ await api('/api/deposits',{method:'POST',body:fd}); toast('Đã gửi yêu cầu nạp tiền, chờ admin duyệt'); await loadPage(); }catch(err){ toast(err.message,false); } }
async function adminServices(){ services=await api('/api/services'); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Quản lý dịch vụ</h2><p class="muted">Dịch vụ đồng bộ từ API mặc định sẽ ẩn. Admin tự tìm kiếm, bật hiện và chỉnh giá trước khi bán.</p><div class="row3"><div class="field"><label>Tên dịch vụ</label><input id="sName"></div><div class="field"><label>Service ID API</label><input id="sAppId" placeholder="VD: 1001"></div><div class="field"><label>Giá bán cho user</label><input id="sPrice" type="number"></div></div><div class="row"><div class="field"><label>Nhà mạng cho phép / Network ID</label><input id="sNet" placeholder="Bỏ trống để tự động, hoặc nhập ID nhà mạng"></div><div class="field"><label>Mô tả</label><input id="sDesc"></div></div><div class="field"><label>Ảnh sản phẩm/dịch vụ</label><input id="sImage" type="file" accept="image/*"></div><button onclick="addService()">Thêm dịch vụ</button></div><div class="card"><h3>Danh sách dịch vụ</h3><div class="field"><label>Tìm kiếm dịch vụ</label><input id="serviceSearch" placeholder="Nhập tên dịch vụ, App ID hoặc nhà mạng" oninput="renderServiceTable()"></div><div class="full-actions"><button class="danger" onclick="hideAllServices()">Ẩn tất cả dịch vụ</button><button class="secondary" onclick="renderServiceTable()">Làm mới danh sách</button></div><div id="serviceTable">${tableServices(services)}</div></div>`); }
function renderServiceTable(){ const q=($('#serviceSearch')?.value||'').toLowerCase().trim(); const rows=services.filter(s=>[s.name,s.external_app_id,s.network,s.description].join(' ').toLowerCase().includes(q)); $('#serviceTable').innerHTML=tableServices(rows); }
function tableServices(rows){ if(!rows.length) return '<p class="muted">Không tìm thấy dịch vụ.</p>'; return `<div class="admin-service-list">${rows.map(s=>`<div class="admin-service-card"><div class="admin-service-grid"><div><label>Nguồn API</label><select id="prov_${s.id}"><option value="legacy" ${s.provider!=='codesim'?'selected':''}>Legacy</option><option value="codesim" ${s.provider==='codesim'?'selected':''}>CodeSim</option></select></div><div><label>Tên</label><input id="n_${s.id}" value="${esc(s.name)}"></div><div><label>Service ID API</label><input id="app_${s.id}" value="${esc(s.external_app_id||'')}"></div><div><label>Ảnh sản phẩm</label>${s.imageUrl?`<a href="${esc(s.imageUrl)}" target="_blank">Xem ảnh</a>`:'<span class="muted">Chưa có</span>'}<input id="img_${s.id}" type="hidden" value="${esc(s.imageUrl||'')}"><input id="file_${s.id}" type="file" accept="image/*"></div><div><label>Nhà mạng / Network ID</label><input id="net_${s.id}" value="${esc(s.network)}"></div><div><label>Giá bán</label><input id="p_${s.id}" type="number" value="${s.price}"></div><div><label>Giá API</label><input id="cost_${s.id}" type="number" value="${s.api_cost||0}"></div><div><label>Hiển thị</label><div class="toggle-line"><input id="v_${s.id}" type="checkbox" ${s.visible?'checked':''}><span>${s.visible?'Đang hiện':'Đang ẩn'}</span></div></div><div class="wide"><label>Mô tả</label><input id="d_${s.id}" value="${esc(s.description||'')}"></div><div class="admin-actions"><button class="small" onclick="saveService('${s.id}')">Lưu</button><button class="small danger" onclick="delService('${s.id}')">Xóa</button></div></div></div>`).join('')}</div>`; }
async function hideAllServices(){ if(!confirm('Ẩn toàn bộ dịch vụ? User sẽ không thấy dịch vụ nào cho tới khi admin bật lại.')) return; await api('/api/admin/services/hide-all',{method:'POST',body:JSON.stringify({})}); toast('Đã ẩn tất cả dịch vụ'); services=await api('/api/services'); renderServiceTable(); }
async function addService(){ try{ let imageUrl=''; if($('#sImage')?.files[0]) imageUrl=await uploadFile($('#sImage')); await api('/api/admin/services',{method:'POST',body:JSON.stringify({name:$('#sName').value,external_app_id:$('#sAppId').value,network:$('#sNet').value,price:$('#sPrice').value,description:$('#sDesc').value,imageUrl,visible:false})}); await loadPage(); }catch(e){ toast(e.message,false); } }
async function saveService(id){ let imageUrl=$('#img_'+id)?.value||''; if($('#file_'+id)?.files[0]) imageUrl=await uploadFile($('#file_'+id)); await api('/api/admin/services/'+id,{method:'PATCH',body:JSON.stringify({provider:$('#prov_'+id)?.value||'legacy',name:$('#n_'+id).value,external_app_id:$('#app_'+id).value,network:$('#net_'+id).value,price:$('#p_'+id).value,api_cost:$('#cost_'+id).value,visible:$('#v_'+id).checked,description:$('#d_'+id).value,imageUrl})}); toast('Đã lưu dịch vụ'); services=await api('/api/services'); renderServiceTable(); }
async function adminApi(){
  $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - API thuê sim</h2><p class="muted">Bên trên là API Legacy chaycodeso3.com, bên dưới là API CodeSim. Khi đồng bộ, hệ thống gọi cả 2 API, dịch vụ mới mặc định ẩn. Khi user thuê, hệ thống tự gọi đúng API theo nguồn của dịch vụ.</p>
  <div class="card soft"><h3>API 1 - Legacy / chaycodeso3.com</h3><div class="field"><label>API URL Legacy</label><input id="legacyApiBaseUrl" value="${esc(settings.legacyApiBaseUrl||settings.apiBaseUrl||'https://chaycodeso3.com/api')}"></div><div class="field"><label>API key Legacy</label><input id="legacyApiKey" value="${esc(settings.legacyApiKey||settings.apiKey||'')}"></div><button class="secondary" onclick="testApiAccount('legacy')">Test Legacy</button><p class="muted">Key hiện tại: ${esc(settings.legacyApiKeyMasked||settings.apiKeyMasked||'Chưa cài')}</p></div>
  <div class="card soft"><h3>API 2 - CodeSim</h3><div class="field"><label>API URL CodeSim</label><input id="codesimApiBaseUrl" value="${esc(settings.codesimApiBaseUrl||'https://apisim.codesim.net')}"></div><div class="field"><label>API key CodeSim</label><input id="codesimApiKey" value="${esc(settings.codesimApiKey||'')}"></div><button class="secondary" onclick="testApiAccount('codesim')">Test CodeSim</button><p class="muted">Key hiện tại: ${esc(settings.codesimApiKeyMasked||'Chưa cài')}</p></div>
  <div class="field"><label>Thời gian chờ OTP trước khi tự hoàn tiền (phút)</label><input id="otpTimeoutMinutes" type="number" min="1" value="${esc(settings.otpTimeoutMinutes||'20')}"></div><div class="flex"><button onclick="saveApiSettings()">Lưu 2 API key</button><button class="secondary" onclick="testBothApi()">Test cả 2 API</button><button class="secondary" onclick="syncApiApps()">Đồng bộ dịch vụ từ cả 2 API</button></div><div id="apiResult" class="notice" style="white-space:pre-wrap;margin-top:12px"></div></div>`);
}
async function saveApiSettings(){ settings=await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify({legacyApiBaseUrl:$('#legacyApiBaseUrl').value,legacyApiKey:$('#legacyApiKey').value,codesimApiBaseUrl:$('#codesimApiBaseUrl').value,codesimApiKey:$('#codesimApiKey').value,otpTimeoutMinutes:$('#otpTimeoutMinutes').value})}); toast('Đã lưu 2 API key'); await loadSettings(); await loadPage(); }
async function testApiAccount(provider='legacy'){ try{ const d=await api('/api/admin/sim-api/account?provider='+encodeURIComponent(provider)); $('#apiResult').textContent=JSON.stringify(d,null,2); }catch(e){ $('#apiResult').textContent=e.message; toast(e.message,false); } }
async function testBothApi(){ try{ const a=await Promise.allSettled([api('/api/admin/sim-api/account?provider=legacy'),api('/api/admin/sim-api/account?provider=codesim')]); $('#apiResult').textContent=JSON.stringify({legacy:a[0].status==='fulfilled'?a[0].value:{error:a[0].reason.message},codesim:a[1].status==='fulfilled'?a[1].value:{error:a[1].reason.message}},null,2); }catch(e){ $('#apiResult').textContent=e.message; toast(e.message,false); } }
async function syncApiApps(){ try{ const d=await api('/api/admin/sim-api/sync-apps',{method:'POST',body:JSON.stringify({overwritePrice:false})}); $('#apiResult').textContent=JSON.stringify(d,null,2); toast(`Đã đồng bộ: thêm ${d.added}, cập nhật ${d.updated}`); }catch(e){ $('#apiResult').textContent=e.message; toast(e.message,false); } }
async function delService(id){ if(confirm('Xóa dịch vụ này?')){ await api('/api/admin/services/'+id,{method:'DELETE'}); await loadPage(); } }
async function adminHistory(){ adminRentals=await api('/api/admin/rentals'); const dmx=await api('/api/admin/dmx/orders').catch(()=>({rows:[],stats:{}})); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Tất cả lịch sử thuê</h2><div class="tablewrap"><table class="table"><tr><th>User</th><th>Dịch vụ</th><th>Nhà mạng</th><th>Số sim</th><th>Giá</th><th>Trạng thái</th><th>OTP</th><th>Thời gian</th><th>Lưu</th></tr>${adminRentals.map(r=>`<tr><td>${esc(r.username)}</td><td>${esc(r.service_name)}</td><td>${esc(r.network)}</td><td>${esc(r.phone_number)}</td><td>${fmt(r.price)}</td><td><input id="rs_${r.id}" value="${esc(r.status)}"></td><td><input id="otp_${r.id}" value="${esc(r.otp_code||'')}"></td><td>${date(r.rented_at)}</td><td><button class="small" onclick="saveRental('${r.id}')">Lưu</button></td></tr>`).join('')}</table></div></div><div class="card"><h2>Admin - Lịch sử mua DMX</h2><div class="stats"><span class="pill">Tổng đơn: <b>${dmx.stats?.totalOrders||0}</b></span><span class="pill">Doanh thu: <b>${fmt(dmx.stats?.revenue||0)}</b></span></div>${tableDmxOrders(dmx.rows||[],true)}</div>`); }
async function saveRental(id){ await api('/api/admin/rentals/'+id,{method:'PATCH',body:JSON.stringify({status:$('#rs_'+id).value,otp_code:$('#otp_'+id).value})}); toast('Đã lưu lượt thuê'); }
async function adminDepositInfo(){ $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Thông tin nhận tiền nạp</h2><div class="field"><label>Thông tin chuyển khoản thủ công</label><textarea id="depositInfo">${esc(settings.depositInfo||'')}</textarea></div><div class="field"><label>Ảnh QR thủ công hiện tại</label><br>${settings.qrImage?`<img class="qr" src="${esc(settings.qrImage)}">`:''}</div><div class="field"><label>Tải QR thủ công mới</label><input id="qrFile" type="file" accept="image/*"></div><h3>Cấu hình SePay tự động</h3><div class="row3"><div class="field"><label>Mã ngân hàng VietQR</label><input id="sepayBankCode" value="${esc(settings.sepayBankCode||'MB')}"></div><div class="field"><label>Số tài khoản</label><input id="sepayAccount" value="${esc(settings.sepayAccount||'')}"></div><div class="field"><label>Tên chủ tài khoản</label><input id="sepayAccountName" value="${esc(settings.sepayAccountName||'')}"></div></div><p class="notice">Webhook SePay cần trỏ tới: <b>${location.origin}/api/sepay/webhook</b></p><button onclick="saveDepositInfo()">Lưu thông tin nạp</button></div>`); }
async function uploadFile(input){ if(!input.files[0]) return ''; const fd=new FormData(); fd.append('file',input.files[0]); const d=await api('/api/upload',{method:'POST',body:fd}); return d.url; }
async function saveDepositInfo(){ let qr=settings.qrImage||''; const f=$('#qrFile'); if(f.files[0]) qr=await uploadFile(f); settings=await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify({depositInfo:$('#depositInfo').value,qrImage:qr,sepayBankCode:$('#sepayBankCode').value,sepayAccount:$('#sepayAccount').value,sepayAccountName:$('#sepayAccountName').value})}); toast('Đã lưu thông tin nạp'); await loadPage(); }
async function adminUsers(){ users=await api('/api/admin/users'); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Quản lý người dùng</h2><div class="field"><label>Tìm kiếm người dùng</label><input id="userSearch" placeholder="Nhập username, quyền hoặc trạng thái" oninput="renderUserTable()"></div><div id="userTable">${tableUsers(users)}</div></div>`); }
function renderUserTable(){ const q=($('#userSearch')?.value||'').toLowerCase().trim(); const rows=users.filter(u=>[u.username,u.role,u.status].join(' ').toLowerCase().includes(q)); $('#userTable').innerHTML=tableUsers(rows); }
function tableUsers(rows){ return `<div class="tablewrap"><table class="table"><tr><th>User</th><th>Quyền</th><th>Số dư</th><th>Cộng/trừ tiền</th><th>Mật khẩu mới</th><th>Chưa truy cập</th><th>Trạng thái</th><th>Thao tác</th></tr>${rows.map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td><input id="bal_${u.id}" type="number" value="${u.balance}"></td><td><input id="add_${u.id}" type="number" placeholder="+/-"></td><td><input id="pass_${u.id}" placeholder="Bỏ trống nếu không đổi"></td><td>${u.days_inactive||0} ngày</td><td>${esc(u.status)}</td><td><button class="small" onclick="saveUser('${u.id}')">Lưu</button> <button class="small danger" onclick="deleteUser('${u.id}')">Xóa</button></td></tr>`).join('')}</table></div>`; }
async function saveUser(id){ const body={balance:$('#bal_'+id).value}; if($('#add_'+id).value) body.addBalance=$('#add_'+id).value; if($('#pass_'+id).value) body.password=$('#pass_'+id).value; await api('/api/admin/users/'+id,{method:'PATCH',body:JSON.stringify(body)}); toast('Đã lưu user'); await loadMe(); await loadPage(); }
async function deleteUser(id){ if(confirm('Xóa user và toàn bộ dữ liệu liên quan?')){ await api('/api/admin/users/'+id,{method:'DELETE'}); await loadPage(); } }
async function adminWeb(){ $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Quản lý web</h2><div class="row"><div class="field"><label>Tên web</label><input id="siteName" value="${esc(settings.siteName||'')}"></div><div class="field"><label>Màu chủ đạo</label><input id="themeColor" type="color" value="${esc(settings.themeColor||'#2563eb')}"></div></div><div class="field"><label>Dòng giới thiệu</label><input id="brandText" value="${esc(settings.brandText||'')}"></div><div class="field"><label>Bố cục</label><select id="layoutMode"><option value="modern">Rộng/hiện đại</option><option value="compact">Gọn</option></select></div><div class="row"><div class="field"><label>Tải logo/thương hiệu</label><input id="logoFile" type="file" accept="image/*"></div><div class="field"><label>Tải ảnh quảng cáo</label><input id="adFile" type="file" accept="image/*"></div></div><button onclick="saveWeb()">Lưu giao diện web</button></div>`); $('#layoutMode').value=settings.layoutMode||'modern'; }
async function saveWeb(){ let logo=settings.logoUrl||'', ad=settings.adUrl||''; if($('#logoFile').files[0]) logo=await uploadFile($('#logoFile')); if($('#adFile').files[0]) ad=await uploadFile($('#adFile')); settings=await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify({siteName:$('#siteName').value,themeColor:$('#themeColor').value,brandText:$('#brandText').value,layoutMode:$('#layoutMode').value,logoUrl:logo,adUrl:ad})}); toast('Đã lưu giao diện'); await loadPage(); }
async function adminApprove(){ adminDeposits=await api('/api/admin/deposits'); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Duyệt nạp tiền</h2><button class="secondary" onclick="markRead()">Đánh dấu đã đọc thông báo</button><h3>Thông báo</h3>${notifications.length?notifications.map(n=>`<div class="notice ${n.read?'':'okbox'}">${esc(n.message)} - ${date(n.created_at)}</div>`).join(''):'<p class="muted">Không có thông báo.</p>'}</div><div class="card"><h2>Yêu cầu nạp tiền</h2><div class="tablewrap"><table class="table"><tr><th>User</th><th>Số tiền</th><th>Nội dung</th><th>PT</th><th>Ảnh</th><th>Trạng thái</th><th>Ghi chú</th><th>Thao tác</th></tr>${adminDeposits.map(d=>`<tr><td>${esc(d.username)}</td><td>${fmt(d.amount)}</td><td>${esc(d.content||'')}</td><td>${esc(d.method||'thủ công')}</td><td>${d.proof_image?`<a href="${esc(d.proof_image)}" target="_blank">Xem ảnh</a>`:''}</td><td><span class="badge ${d.status==='Đã duyệt'?'status-ok':d.status==='Từ chối'?'status-no':'status-wait'}">${esc(d.status)}</span></td><td><input id="note_${d.id}" value="${esc(d.admin_note||'')}"></td><td><button class="small ok" onclick="reviewDeposit('${d.id}','Đã duyệt')">Duyệt</button> <button class="small danger" onclick="reviewDeposit('${d.id}','Từ chối')">Từ chối</button></td></tr>`).join('')}</table></div></div>`); }
async function reviewDeposit(id,status){ await api('/api/admin/deposits/'+id,{method:'PATCH',body:JSON.stringify({status,admin_note:$('#note_'+id).value})}); toast('Đã cập nhật nạp tiền'); await loadMe(); await loadPage(); }
async function markRead(){ await api('/api/admin/notifications/read',{method:'PATCH',body:JSON.stringify({})}); await loadPage(); }
boot();
// ===== Tab Hailen - API Key =====
const hailenTabHTML = `
<div id="hailen-tab" style="padding:15px; border:1px solid #ccc; margin-top:10px;">
  <h3>User Hailen - API OTP24h</h3>
  <p>API Key riêng của bạn: <strong>248c26ea0cd1371009db5dd443339ca1</strong></p>
  <p>Cách gọi API trực tiếp:</p>
  <pre>GET https://coalldichvu-1.onrender.com/api/hailen/history?user=hailen&key=248c26ea0cd1371009db5dd443339ca1</pre>

  <label>Nhập API Key nếu muốn override:</label><br/>
  <input type="text" id="hailenApiKey" value="248c26ea0cd1371009db5dd443339ca1" style="width:300px;"/>
  <button id="callHailenAPI">Cập nhật lịch sử</button>

  <h4>Kết quả trả về:</h4>
  <pre id="hailenResult" style="background:#f5f5f5; padding:10px;"></pre>
</div>`;

// Thêm tab vào SPA container #app
document.querySelector('#app').insertAdjacentHTML('beforeend', hailenTabHTML);

// ===== Hàm gọi API Hailen =====
window.updateHailenHistory = async function() {
    const key = document.getElementById('hailenApiKey').value.trim();
    if(!key){ alert('Nhập API Key'); return; }

    // URL đã thay bằng domain Render của bạn
    const res = await fetch('/api/hailen/history?key='+key+'&user=hailen');
    const data = await res.json();

    document.getElementById('hailenResult').textContent = JSON.stringify(data, null, 2);
};

// Gán sự kiện cho button
document.getElementById('callHailenAPI').addEventListener('click', updateHailenHistory);
