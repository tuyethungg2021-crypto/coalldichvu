const API = '';
let token = localStorage.getItem('token') || '';
let me = null;
let settings = {};
let tab = 'services';
let services = [], rentals = [], deposits = [], users = [], adminRentals = [], adminDeposits = [], notifications = [], dmxProducts = [];

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
async function loadSettings(){ settings = await api('/api/settings'); document.documentElement.style.setProperty('--brand', settings.themeColor || '#2563eb'); document.body.classList.toggle('layout-compact', settings.layoutMode === 'compact'); }
async function loadMe(){ if(!token) return; try{ const d = await api('/api/me'); me = d.user; }catch(e){ token=''; localStorage.removeItem('token'); me=null; } }
async function boot(){ await loadSettings(); await loadMe(); if(!me) renderAuth(); else await loadPage(); }
function header(){
  return `<div class="top"><div class="wrap topin"><div class="brand">${settings.logoUrl?`<img class="logo" src="${esc(settings.logoUrl)}">`:`<div class="logo"></div>`}<div><h1>${esc(settings.siteName||'Có All Dịch Vụ')}</h1><p>${esc(settings.brandText||'')}</p></div></div><div class="userbar"><span class="pill">${esc(me.username)} ${me.role==='admin'?'• Admin':''}</span><span class="pill">Số dư: <b>${fmt(me.balance)}</b></span><button class="secondary" onclick="logout()">Đăng xuất</button></div></div></div>`;
}
function menu(){
  const common = [['services','Dịch vụ'],['dmx','Dịch vụ DMX'],['history','Lịch sử'],['deposit','Nạp tiền']];
  const admin = [['admin_services','Dịch vụ admin'],['admin_dmx','Admin DMX'],['admin_api','API thuê sim'],['admin_history','Lịch sử admin'],['admin_deposit_info','Nạp tiền admin'],['admin_users','Quản lý người dùng'],['admin_web','Quản lý web'],['admin_approve','Duyệt nạp tiền']];
  const items = me.role==='admin' ? common.concat(admin) : common;
  const unread = notifications.filter(n=>!n.read).length;
  return `<div class="side">${items.map(i=>`<button class="tab ${tab===i[0]?'active':''}" onclick="setTab('${i[0]}')">${i[1]}${i[0]==='admin_approve'&&unread?` (${unread})`:''}</button>`).join('')}</div>`;
}
async function loadPage(){
  await loadSettings();
  if(me?.role==='admin') notifications = await api('/api/admin/notifications').catch(()=>[]);
  app.innerHTML = header()+`<div class="wrap grid">${menu()}<div class="main"></div></div><div class="footer">Dữ liệu dùng chung qua server JSON. Không xóa thư mục data/uploads để giữ dữ liệu.</div>`;
  if(settings.adUrl) $('.main').insertAdjacentHTML('beforeend', `<img class="ad" src="${esc(settings.adUrl)}">`);
  await renderTab();
}
async function setTab(t){ tab=t; await loadPage(); }
function logout(){ localStorage.removeItem('token'); token=''; me=null; renderAuth(); }
function renderAuth(){
  app.innerHTML = `<div class="wrap auth card"><h2>${esc(settings.siteName||'Có All Dịch Vụ')}</h2><div id="msg"></div><div class="field"><label>Tài khoản</label><input id="username" placeholder="Nhập tài khoản"></div><div class="field"><label>Mật khẩu</label><input id="password" type="password" placeholder="Nhập mật khẩu"></div><div class="flex"><button onclick="login()">Đăng nhập</button><button class="secondary" onclick="register()">Đăng ký user</button></div><p class="muted">Admin mặc định: hungnbyt / azhung12. Sau khi deploy nên đổi mật khẩu.</p></div>`;
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
  $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Dịch vụ thuê sim</h2><p class="muted">Chọn dịch vụ và nhà mạng muốn thuê. Web sẽ gọi API thật để lấy số, sau đó bạn bấm Lấy code. User không thấy ID/nguồn API.</p><div class="servicegrid">${services.map(s=>`<div class="svc"><h3>${esc(s.name)}</h3><p class="muted">${esc(s.description||'')}</p><div class="field"><label>Nhà mạng</label><select id="carrier_${s.id}">${carrierOptions(s.network)}</select></div><div class="price">${fmt(s.price)}</div><button onclick="rent('${s.id}')">Thuê sim</button></div>`).join('')}</div></div><div class="card"><h2>Sim đang thuê</h2><div id="activeRentals"></div></div>`);
  rentals = await api('/api/rentals');
  $('#activeRentals').innerHTML = tableRentals(rentals.filter(r=>String(r.status).includes('chờ') || r.status==='Đang thuê'));
}
function carrierOptions(network){ const allowed=['Viettel','Mobi','Vina','VNMB','ITelecom']; const n=String(network||''); const list=allowed.filter(x=>n.includes(x)); const arr=list.length?list:allowed; return arr.map(x=>`<option value="${x}">${x}</option>`).join(''); }
async function rent(id){ try{ const el=$('#carrier_'+id); const d=await api('/api/rentals',{method:'POST',body:JSON.stringify({service_id:id,carrier:el?el.value:''})}); me=d.user; toast('Thuê sim thành công: '+d.rental.phone_number); await loadMe(); await loadPage(); }catch(e){ toast(e.message,false); } }
async function checkCode(id){ try{ const d=await api('/api/rentals/'+id+'/check-code',{method:'POST',body:JSON.stringify({})}); if(d.user) me=d.user; const msg=d.api?.Msg || 'Đã kiểm tra code'; toast(msg + (d.rental.otp_code?(': '+d.rental.otp_code):'')); await loadMe(); await loadPage(); }catch(e){ toast(e.message,false); } }
function tableRentals(rows){ if(!rows.length) return '<p class="muted">Chưa có dữ liệu.</p>'; return `<div class="tablewrap"><table class="table"><tr><th>Dịch vụ</th><th>Nhà mạng</th><th>Số sim</th><th>Giá</th><th>Trạng thái</th><th>OTP/SMS</th><th>Thời gian</th><th>Thao tác</th></tr>${rows.map(r=>`<tr><td>${esc(r.service_name)}</td><td>${esc(r.network)}</td><td><b>${esc(r.phone_number)}</b></td><td>${fmt(r.price)}</td><td><span class="badge">${esc(r.status)}</span><br><small>${esc(r.note||'')}</small></td><td><b>${esc(r.otp_code||'Chưa có')}</b><br><small>${esc(r.sms||'')}</small></td><td>${date(r.rented_at)}</td><td>${r.external_id?`<button class="small ok" onclick="checkCode('${r.id}')">Lấy code</button>`:''} ${r.service_id?`<button class="small" onclick="rent('${r.service_id}')">Thuê lại</button>`:''}</td></tr>`).join('')}</table></div>`; }
async function userHistory(){ rentals=await api('/api/rentals'); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Lịch sử thuê sim</h2>${tableRentals(rentals)}</div>`); }

async function userDmx(){
  dmxProducts = await api('/api/dmx-products');
  const cats = [...new Set(dmxProducts.map(p=>p.category||'Khác'))].sort((a,b)=>a.localeCompare(b,'vi'));
  $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Dịch vụ DMX</h2><div class="row"><div class="field"><label>Tìm theo tên sản phẩm</label><input id="dmxSearch" oninput="renderDmxList()" placeholder="Nhập tên sản phẩm"></div><div class="field"><label>Lọc danh mục</label><select id="dmxCat" onchange="renderDmxList()"><option value="">Tất cả danh mục</option>${cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div></div><div id="dmxList"></div></div>`);
  renderDmxList();
}
function renderDmxList(){
  const q=String($('#dmxSearch')?.value||'').toLowerCase(); const cat=$('#dmxCat')?.value||'';
  const rows=dmxProducts.filter(p=>(!cat || p.category===cat) && String(p.name||'').toLowerCase().includes(q)).sort((a,b)=>String(a.category||'').localeCompare(String(b.category||''),'vi') || String(a.name||'').localeCompare(String(b.name||''),'vi'));
  $('#dmxList').innerHTML = rows.length ? `<div class="servicegrid">${rows.map(p=>`<div class="svc product"><div class="cat">${esc(p.category||'Khác')}</div>${p.image?`<img class="product-img" src="${esc(p.image)}">`:''}<h3>${esc(p.name)}</h3><div class="price">${fmt(p.price)}</div>${p.bulkDiscount?`<p><span class="badge">${esc(p.bulkDiscount)}</span></p>`:''}<p class="muted">${esc(p.description||'')}</p></div>`).join('')}</div>` : '<p class="muted">Chưa có sản phẩm phù hợp.</p>';
}

async function userDeposit(){
  deposits=await api('/api/deposits');
  $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Nạp tiền</h2><div class="row"><div><div class="notice">${esc(settings.depositInfo||'')}</div>${settings.qrImage?`<img class="qr" src="${esc(settings.qrImage)}">`:''}</div><form onsubmit="sendDeposit(event)"><div class="field"><label>Số tiền đã nạp</label><input id="depAmount" type="number" min="1000" required></div><div class="field"><label>Nội dung chuyển khoản</label><input id="depContent" placeholder="VD: nap ${esc(me.username)}"></div><div class="field"><label>Ảnh bill/chứng từ</label><input id="depProof" type="file" accept="image/*"></div><button>Gửi yêu cầu nạp</button></form></div></div><div class="card"><h2>Lịch sử nạp</h2>${tableDeposits(deposits)}</div>`);
}
function tableDeposits(rows){ if(!rows.length) return '<p class="muted">Chưa có yêu cầu nạp.</p>'; return `<div class="tablewrap"><table class="table"><tr><th>Số tiền</th><th>Nội dung</th><th>Trạng thái</th><th>Ảnh</th><th>Ngày gửi</th><th>Ghi chú admin</th></tr>${rows.map(d=>`<tr><td>${fmt(d.amount)}</td><td>${esc(d.content||'')}</td><td><span class="badge ${d.status==='Đã duyệt'?'status-ok':d.status==='Từ chối'?'status-no':'status-wait'}">${esc(d.status)}</span></td><td>${d.proof_image?`<a href="${esc(d.proof_image)}" target="_blank">Xem ảnh</a>`:''}</td><td>${date(d.created_at)}</td><td>${esc(d.admin_note||'')}</td></tr>`).join('')}</table></div>`; }
async function sendDeposit(e){ e.preventDefault(); const fd=new FormData(); fd.append('amount',$('#depAmount').value); fd.append('content',$('#depContent').value); if($('#depProof').files[0]) fd.append('proof',$('#depProof').files[0]); try{ await api('/api/deposits',{method:'POST',body:fd}); toast('Đã gửi yêu cầu nạp tiền, chờ admin duyệt'); await loadPage(); }catch(err){ toast(err.message,false); } }

async function adminServices(){ services=await api('/api/services'); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Quản lý dịch vụ</h2><p class="muted">Dịch vụ đồng bộ từ API mặc định ẩn. Admin tìm kiếm, bật dịch vụ muốn bán rồi chỉnh giá.</p><div class="field"><label>Tìm dịch vụ</label><input id="svcSearch" oninput="renderAdminServiceTable()" placeholder="Tìm theo tên/App ID/nhà mạng"></div><div class="row3"><div class="field"><label>Tên dịch vụ</label><input id="sName"></div><div class="field"><label>App ID API</label><input id="sAppId" placeholder="VD: 1001"></div><div class="field"><label>Giá bán cho user</label><input id="sPrice" type="number"></div></div><div class="row"><div class="field"><label>Nhà mạng cho phép</label><input id="sNet" value="Viettel,Mobi,Vina,VNMB,ITelecom"></div><div class="field"><label>Mô tả</label><input id="sDesc"></div></div><button onclick="addService()">Thêm dịch vụ</button></div><div class="card"><div id="serviceTable"></div></div>`); renderAdminServiceTable(); }
function renderAdminServiceTable(){ const q=String($('#svcSearch')?.value||'').toLowerCase(); const rows=services.filter(s=>[s.name,s.external_app_id,s.network].join(' ').toLowerCase().includes(q)); $('#serviceTable').innerHTML=tableServices(rows); }
function tableServices(rows){ return `<div class="tablewrap"><table class="table"><tr><th>Tên</th><th>App ID</th><th>Nhà mạng</th><th>Giá bán</th><th>Giá API</th><th>Hiện</th><th>Mô tả</th><th>Lưu</th></tr>${rows.map(s=>`<tr><td><input id="n_${s.id}" value="${esc(s.name)}"></td><td><input id="app_${s.id}" value="${esc(s.external_app_id||'')}"></td><td><input id="net_${s.id}" value="${esc(s.network)}"></td><td><input id="p_${s.id}" type="number" value="${s.price}"></td><td><input id="cost_${s.id}" type="number" value="${s.api_cost||0}"></td><td><input id="v_${s.id}" type="checkbox" ${s.visible?'checked':''}></td><td><input id="d_${s.id}" value="${esc(s.description||'')}"></td><td><button class="small" onclick="saveService('${s.id}')">Lưu</button> <button class="small danger" onclick="delService('${s.id}')">Xóa</button></td></tr>`).join('')}</table></div>`; }
async function addService(){ try{ await api('/api/admin/services',{method:'POST',body:JSON.stringify({name:$('#sName').value,external_app_id:$('#sAppId').value,network:$('#sNet').value,price:$('#sPrice').value,description:$('#sDesc').value,visible:false})}); toast('Đã thêm, mặc định đang ẩn'); await loadPage(); }catch(e){ toast(e.message,false); } }
async function saveService(id){ await api('/api/admin/services/'+id,{method:'PATCH',body:JSON.stringify({name:$('#n_'+id).value,external_app_id:$('#app_'+id).value,network:$('#net_'+id).value,price:$('#p_'+id).value,api_cost:$('#cost_'+id).value,visible:$('#v_'+id).checked,description:$('#d_'+id).value})}); toast('Đã lưu dịch vụ'); }
async function delService(id){ if(confirm('Xóa dịch vụ này?')){ await api('/api/admin/services/'+id,{method:'DELETE'}); await loadPage(); } }

async function adminDmx(){ dmxProducts=await api('/api/dmx-products'); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Dịch vụ DMX</h2><div class="row"><div class="field"><label>Tên sản phẩm</label><input id="pName"></div><div class="field"><label>Danh mục</label><input id="pCategory" placeholder="VD: Facebook, Zalo, Tool"></div></div><div class="row"><div class="field"><label>Giá</label><input id="pPrice" type="number"></div><div class="field"><label>Mua nhiều giảm giá</label><input id="pBulk" placeholder="VD: Mua 10 giảm 5%, mua 50 giảm 15%"></div></div><div class="field"><label>Mô tả sản phẩm</label><textarea id="pDesc"></textarea></div><div class="field"><label>Ảnh sản phẩm</label><input id="pImage" type="file" accept="image/*"></div><button onclick="addDmxProduct()">Thêm sản phẩm DMX</button></div><div class="card"><h2>Danh sách sản phẩm</h2><div class="row"><div class="field"><label>Tìm sản phẩm</label><input id="adminDmxSearch" oninput="renderAdminDmxTable()"></div><div class="field"><label>Lọc danh mục</label><input id="adminDmxCat" oninput="renderAdminDmxTable()"></div></div><div id="adminDmxTable"></div></div>`); renderAdminDmxTable(); }
function renderAdminDmxTable(){ const q=String($('#adminDmxSearch')?.value||'').toLowerCase(); const c=String($('#adminDmxCat')?.value||'').toLowerCase(); const rows=dmxProducts.filter(p=>String(p.name||'').toLowerCase().includes(q)&&String(p.category||'').toLowerCase().includes(c)); $('#adminDmxTable').innerHTML=`<div class="tablewrap"><table class="table"><tr><th>Ảnh</th><th>Tên</th><th>Danh mục</th><th>Giá</th><th>Mua nhiều giảm giá</th><th>Mô tả</th><th>Hiện</th><th>Lưu</th></tr>${rows.map(p=>`<tr><td>${p.image?`<img class="preview" src="${esc(p.image)}">`:''}<input id="img_${p.id}" type="file" accept="image/*"></td><td><input id="pn_${p.id}" value="${esc(p.name)}"></td><td><input id="pc_${p.id}" value="${esc(p.category||'Khác')}"></td><td><input id="pp_${p.id}" type="number" value="${p.price||0}"></td><td><input id="pb_${p.id}" value="${esc(p.bulkDiscount||'')}"></td><td><input id="pd_${p.id}" value="${esc(p.description||'')}"></td><td><input id="pv_${p.id}" type="checkbox" ${p.visible?'checked':''}></td><td><button class="small" onclick="saveDmxProduct('${p.id}')">Lưu</button> <button class="small danger" onclick="deleteDmxProduct('${p.id}')">Xóa</button></td></tr>`).join('')}</table></div>`; }
async function uploadFile(input){ if(!input.files[0]) return ''; const fd=new FormData(); fd.append('file',input.files[0]); const d=await api('/api/upload',{method:'POST',body:fd}); return d.url; }
async function addDmxProduct(){ try{ let image=''; if($('#pImage').files[0]) image=await uploadFile($('#pImage')); await api('/api/admin/dmx-products',{method:'POST',body:JSON.stringify({name:$('#pName').value,category:$('#pCategory').value,price:$('#pPrice').value,bulkDiscount:$('#pBulk').value,description:$('#pDesc').value,image,visible:true})}); toast('Đã thêm sản phẩm DMX'); await loadPage(); }catch(e){ toast(e.message,false); } }
async function saveDmxProduct(id){ let image=dmxProducts.find(p=>p.id===id)?.image||''; const f=$('#img_'+id); if(f && f.files[0]) image=await uploadFile(f); await api('/api/admin/dmx-products/'+id,{method:'PATCH',body:JSON.stringify({name:$('#pn_'+id).value,category:$('#pc_'+id).value,price:$('#pp_'+id).value,bulkDiscount:$('#pb_'+id).value,description:$('#pd_'+id).value,visible:$('#pv_'+id).checked,image})}); toast('Đã lưu sản phẩm'); await loadPage(); }
async function deleteDmxProduct(id){ if(confirm('Xóa sản phẩm DMX này?')){ await api('/api/admin/dmx-products/'+id,{method:'DELETE'}); await loadPage(); } }

async function adminApi(){ $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - API thuê sim</h2><p class="muted">API key được lưu ở server, user thường không nhìn thấy.</p><div class="field"><label>API URL</label><input id="apiBaseUrl" value="${esc(settings.apiBaseUrl||'https://chaycodeso3.com/api')}"></div><div class="field"><label>API key</label><input id="apiKey" value="${esc(settings.apiKey||'')}" placeholder="Nhập API key"></div><div class="flex"><button onclick="saveApiSettings()">Lưu API key</button><button class="secondary" onclick="testApiAccount()">Test tài khoản API</button><button class="secondary" onclick="syncApiApps()">Đồng bộ dịch vụ từ API</button></div><div id="apiResult" class="notice" style="white-space:pre-wrap;margin-top:12px">${settings.apiKeyMasked?('API hiện tại: '+esc(settings.apiKeyMasked)):'Chưa cài API key'}</div></div>`); }
async function saveApiSettings(){ settings=await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify({apiBaseUrl:$('#apiBaseUrl').value,apiKey:$('#apiKey').value})}); toast('Đã lưu API key'); await loadSettings(); }
async function testApiAccount(){ try{ const d=await api('/api/admin/sim-api/account'); $('#apiResult').textContent=JSON.stringify(d,null,2); }catch(e){ $('#apiResult').textContent=e.message; toast(e.message,false); } }
async function syncApiApps(){ try{ const d=await api('/api/admin/sim-api/sync-apps',{method:'POST',body:JSON.stringify({overwritePrice:false})}); $('#apiResult').textContent=JSON.stringify(d,null,2); toast(`Đã đồng bộ: thêm ${d.added}, cập nhật ${d.updated}. Dịch vụ mới mặc định ẩn.`); }catch(e){ $('#apiResult').textContent=e.message; toast(e.message,false); } }
async function adminHistory(){ adminRentals=await api('/api/admin/rentals'); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Tất cả lịch sử thuê</h2><div class="tablewrap"><table class="table"><tr><th>User</th><th>Dịch vụ</th><th>API ID</th><th>Nhà mạng</th><th>Số sim</th><th>Giá</th><th>Trạng thái</th><th>OTP</th><th>Thời gian</th><th>Lưu</th></tr>${adminRentals.map(r=>`<tr><td>${esc(r.username)}</td><td>${esc(r.service_name)}</td><td>${esc(r.external_id||'')}</td><td>${esc(r.network)}</td><td>${esc(r.phone_number)}</td><td>${fmt(r.price)}</td><td><input id="rs_${r.id}" value="${esc(r.status)}"></td><td><input id="otp_${r.id}" value="${esc(r.otp_code||'')}"></td><td>${date(r.rented_at)}</td><td><button class="small" onclick="saveRental('${r.id}')">Lưu</button></td></tr>`).join('')}</table></div></div>`); }
async function saveRental(id){ await api('/api/admin/rentals/'+id,{method:'PATCH',body:JSON.stringify({status:$('#rs_'+id).value,otp_code:$('#otp_'+id).value})}); toast('Đã lưu lượt thuê'); }
async function adminDepositInfo(){ $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Thông tin nhận tiền nạp</h2><div class="field"><label>Thông tin chuyển khoản</label><textarea id="depositInfo">${esc(settings.depositInfo||'')}</textarea></div><div class="field"><label>Ảnh QR hiện tại</label><br>${settings.qrImage?`<img class="qr" src="${esc(settings.qrImage)}">`:''}</div><div class="field"><label>Tải QR mới</label><input id="qrFile" type="file" accept="image/*"></div><button onclick="saveDepositInfo()">Lưu thông tin nạp</button></div>`); }
async function saveDepositInfo(){ let qr=settings.qrImage||''; const f=$('#qrFile'); if(f.files[0]) qr=await uploadFile(f); settings=await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify({depositInfo:$('#depositInfo').value,qrImage:qr})}); toast('Đã lưu thông tin nạp'); await loadPage(); }
async function adminUsers(){ users=await api('/api/admin/users'); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Quản lý người dùng</h2><div class="field"><label>Tìm user</label><input id="userSearch" oninput="renderUserTable()" placeholder="Nhập username"></div><div id="userTable"></div></div>`); renderUserTable(); }
function renderUserTable(){ const q=String($('#userSearch')?.value||'').toLowerCase(); const rows=users.filter(u=>String(u.username||'').toLowerCase().includes(q)); $('#userTable').innerHTML=`<div class="tablewrap"><table class="table"><tr><th>User</th><th>Quyền</th><th>Số dư</th><th>Cộng/trừ tiền</th><th>Mật khẩu mới</th><th>Chưa truy cập</th><th>Trạng thái</th><th>Thao tác</th></tr>${rows.map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td><input id="bal_${u.id}" type="number" value="${u.balance}"></td><td><input id="add_${u.id}" type="number" placeholder="+/-"></td><td><input id="pass_${u.id}" placeholder="Bỏ trống nếu không đổi"></td><td>${u.days_inactive||0} ngày</td><td>${esc(u.status)}</td><td><button class="small" onclick="saveUser('${u.id}')">Lưu</button> <button class="small danger" onclick="deleteUser('${u.id}')">Xóa</button></td></tr>`).join('')}</table></div>`; }
async function saveUser(id){ const body={balance:$('#bal_'+id).value}; if($('#add_'+id).value) body.addBalance=$('#add_'+id).value; if($('#pass_'+id).value) body.password=$('#pass_'+id).value; await api('/api/admin/users/'+id,{method:'PATCH',body:JSON.stringify(body)}); toast('Đã lưu user'); await loadMe(); await loadPage(); }
async function deleteUser(id){ if(confirm('Xóa user và toàn bộ dữ liệu liên quan?')){ await api('/api/admin/users/'+id,{method:'DELETE'}); await loadPage(); } }
async function adminWeb(){ $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Quản lý web</h2><div class="row"><div class="field"><label>Tên web</label><input id="siteName" value="${esc(settings.siteName||'')}"></div><div class="field"><label>Màu chủ đạo</label><input id="themeColor" type="color" value="${esc(settings.themeColor||'#2563eb')}"></div></div><div class="field"><label>Dòng giới thiệu</label><input id="brandText" value="${esc(settings.brandText||'')}"></div><div class="field"><label>Bố cục</label><select id="layoutMode"><option value="modern">Rộng/hiện đại</option><option value="compact">Gọn</option></select></div><div class="row"><div class="field"><label>Tải logo/thương hiệu</label><input id="logoFile" type="file" accept="image/*"></div><div class="field"><label>Tải ảnh quảng cáo</label><input id="adFile" type="file" accept="image/*"></div></div><button onclick="saveWeb()">Lưu giao diện web</button></div>`); $('#layoutMode').value=settings.layoutMode||'modern'; }
async function saveWeb(){ let logo=settings.logoUrl||'', ad=settings.adUrl||''; if($('#logoFile').files[0]) logo=await uploadFile($('#logoFile')); if($('#adFile').files[0]) ad=await uploadFile($('#adFile')); settings=await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify({siteName:$('#siteName').value,themeColor:$('#themeColor').value,brandText:$('#brandText').value,layoutMode:$('#layoutMode').value,logoUrl:logo,adUrl:ad})}); toast('Đã lưu giao diện'); await loadPage(); }
async function adminApprove(){ adminDeposits=await api('/api/admin/deposits'); $('.main').insertAdjacentHTML('beforeend', `<div class="card"><h2>Admin - Duyệt nạp tiền</h2><button class="secondary" onclick="markRead()">Đánh dấu đã đọc thông báo</button><h3>Thông báo</h3>${notifications.length?notifications.map(n=>`<div class="notice ${n.read?'':'okbox'}">${esc(n.message)} - ${date(n.created_at)}</div>`).join(''):'<p class="muted">Không có thông báo.</p>'}</div><div class="card"><h2>Yêu cầu nạp tiền</h2><div class="tablewrap"><table class="table"><tr><th>User</th><th>Số tiền</th><th>Nội dung</th><th>Ảnh</th><th>Trạng thái</th><th>Ghi chú</th><th>Thao tác</th></tr>${adminDeposits.map(d=>`<tr><td>${esc(d.username)}</td><td>${fmt(d.amount)}</td><td>${esc(d.content||'')}</td><td>${d.proof_image?`<a href="${esc(d.proof_image)}" target="_blank">Xem ảnh</a>`:''}</td><td><span class="badge ${d.status==='Đã duyệt'?'status-ok':d.status==='Từ chối'?'status-no':'status-wait'}">${esc(d.status)}</span></td><td><input id="note_${d.id}" value="${esc(d.admin_note||'')}"></td><td><button class="small ok" onclick="reviewDeposit('${d.id}','Đã duyệt')">Duyệt</button> <button class="small danger" onclick="reviewDeposit('${d.id}','Từ chối')">Từ chối</button></td></tr>`).join('')}</table></div></div>`); }
async function reviewDeposit(id,status){ await api('/api/admin/deposits/'+id,{method:'PATCH',body:JSON.stringify({status,admin_note:$('#note_'+id).value})}); toast('Đã cập nhật nạp tiền'); await loadMe(); await loadPage(); }
async function markRead(){ await api('/api/admin/notifications/read',{method:'PATCH',body:JSON.stringify({})}); await loadPage(); }
boot();
