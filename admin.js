(function () {
  'use strict';

  var INTERESTS = {
    'gian-hang': 'Đăng ký gian hàng', 'vegan-run': 'Vegan Run 2027', 'nau-an': 'Cuộc thi nấu ăn VVCC',
    'tinh-nguyen': 'Tình nguyện viên', 'tai-tro': 'Tài trợ / Đồng hành', 'khac': 'Khác'
  };
  var STATUSES = { 'moi': 'Mới', 'da-lien-he': 'Đã liên hệ', 'hoan-tat': 'Hoàn tất', 'huy': 'Hủy' };
  var UNIT_COLUMNS = [
    ['ten', 'Tên đơn vị'], ['nganh', 'Ngành nghề'], ['sanPham', 'Sản phẩm tiêu biểu'], ['moTa', 'Giới thiệu ngắn'],
    ['nguoiLienHe', 'Người liên hệ'], ['dienThoai', 'Điện thoại'], ['email', 'Email'], ['website', 'Website / Fanpage'],
    ['diaChi', 'Địa chỉ'], ['khu', 'Gian hàng / Khu'], ['logoFile', 'Tên file logo']
  ];
  var HEADER_ALIASES = {
    tendonvi: 'ten', ten: 'ten', donvi: 'ten', tendoanhnghiep: 'ten', doanhnghiep: 'ten',
    nganhnghe: 'nganh', nganh: 'nganh', linhvuc: 'nganh',
    sanphamtieubieu: 'sanPham', sanpham: 'sanPham',
    gioithieungan: 'moTa', gioithieu: 'moTa', mota: 'moTa',
    nguoilienhe: 'nguoiLienHe', lienhe: 'nguoiLienHe',
    dienthoai: 'dienThoai', sodienthoai: 'dienThoai', sdt: 'dienThoai',
    email: 'email', websitefanpage: 'website', website: 'website', fanpage: 'website',
    diachi: 'diaChi', gianhangkhu: 'khu', khugianhang: 'khu', gianhang: 'khu', khu: 'khu',
    tenfilelogo: 'logoFile', filelogo: 'logoFile', logo: 'logoFile'
  };
  var CONTENT_DEFAULTS = {
    lienHe: { hotline: '', email: '', fanpage: '', zalo: '', diaChi: '' },
    dangKyMo: true,
    thongBao: { bat: false, kieu: 'info', noiDung: '', lienKet: '' },
    lichTrinh: [],
    taiTro: { tongThe: [], chuyenDe: [] }
  };
  var TEMPLATES = {
    day: function () { return { tab: '', nhan: '', tieuDe: '', muc: [] }; },
    item: function () { return { gio: '', ten: '', moTa: '', noiBat: false }; },
    tier: function () { return { ten: '', gia: '', nhan: '', kieu: 'green', quyenLoi: [] }; },
    topic: function () { return { ten: '', gia: '', moTa: '' }; }
  };

  var S = {
    key: null, content: null, news: [], units: [], regs: [],
    pendingImg: { units: {}, news: {} },   // id -> Blob chờ tải lên
    preview: {},                           // id -> objectURL xem trước
    removeFiles: { units: [], news: [] },  // file cần xóa trên máy chủ khi lưu
    dirty: { content: false, news: false, units: false },
    editing: null
  };

  // ---------- Tiện ích ----------
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slug(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }
  function key(s) { return slug(s).replace(/-/g, ''); }
  function uniqueId(name, list) {
    var base = slug(name) || 'muc', id = base, i = 2;
    while (list.some(function (x) { return x.id === id; })) id = base + '-' + i++;
    return id;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function toast(msg, err) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.className = 'toast'; }, err ? 6000 : 3000);
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function store(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function setDirty(part, on) {
    S.dirty[part] = on;
    $$('[data-save="' + part + '"]').forEach(function (b) { b.classList.toggle('dirty', on); });
  }

  function api(action, opt) {
    opt = opt || {};
    var qs = new URLSearchParams(Object.assign({ action: action }, opt.query || {}));
    var headers = { 'X-Admin-Key': opt.pw || S.key || '' };
    if (opt.type) headers['Content-Type'] = opt.type;
    return fetch('api.php?' + qs, { method: opt.method || 'GET', headers: headers, body: opt.body })
      .catch(function () { throw new Error('Không kết nối được máy chủ. Kiểm tra mạng hoặc máy chủ đang chạy.'); })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          // Trang tĩnh (GitHub Pages…) trả về mã nguồn PHP thay vì chạy nó
          if (data === null) throw new Error('Máy chủ này không chạy được trang quản trị (cần hosting có PHP, ví dụ Hostinger).');
          if (r.status === 401 && action !== 'login') { logout('Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại.'); }
          if (!r.ok) throw new Error(data.error || ('Lỗi máy chủ (' + r.status + ')'));
          if (action === 'login' && data.ok !== true) throw new Error('Máy chủ trả lời không hợp lệ.');
          return data;
        });
      });
  }
  function getJson(file, fallback) {
    return fetch('data/' + file + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : fallback; })
      .catch(function () { return fallback; });
  }
  // Thu nhỏ ảnh và chuyển sang WebP trên trình duyệt trước khi tải lên
  function toWebp(file, max) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || max, h = img.naturalHeight || max;
        var s = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Không chuyển được ảnh ' + file.name)); }, 'image/webp', 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh ' + file.name)); };
      img.src = url;
    });
  }
  function setPreview(id, blob) {
    if (S.preview[id]) URL.revokeObjectURL(S.preview[id]);
    S.preview[id] = blob ? URL.createObjectURL(blob) : null;
  }
  function fileNameOf(path) { return String(path || '').split('?')[0].split('/').pop(); }

  // ---------- Đăng nhập ----------
  function logout(msg) {
    S.key = null; store('ak', null);
    $('#app').hidden = true; $('#login').hidden = false;
    $('#login-msg').textContent = msg || '';
  }
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('#login-pw').value;
    $('#login-msg').textContent = 'Đang kiểm tra…';
    api('login', { pw: pw }).then(function () {
      S.key = pw; store('ak', pw); $('#login-pw').value = ''; start();
    }).catch(function (err) { $('#login-msg').textContent = err.message; });
  });
  $('#logout').addEventListener('click', function () {
    if (anyDirty() && !confirm('Có thay đổi chưa lưu. Vẫn đăng xuất?')) return;
    logout('Đã đăng xuất.');
  });
  function anyDirty() { return S.dirty.content || S.dirty.news || S.dirty.units; }
  window.addEventListener('beforeunload', function (e) { if (S.key && anyDirty()) { e.preventDefault(); e.returnValue = ''; } });

  function start() {
    $('#login').hidden = true; $('#app').hidden = false;
    Promise.all([getJson('content.json', {}), getJson('tin-tuc.json', []), getJson('don-vi.json', [])]).then(function (r) {
      S.content = Object.assign(clone(CONTENT_DEFAULTS), r[0] || {});
      S.content.lienHe = Object.assign(clone(CONTENT_DEFAULTS.lienHe), S.content.lienHe || {});
      S.content.thongBao = Object.assign(clone(CONTENT_DEFAULTS.thongBao), S.content.thongBao || {});
      S.content.taiTro = Object.assign(clone(CONTENT_DEFAULTS.taiTro), S.content.taiTro || {});
      S.news = Array.isArray(r[1]) ? r[1] : [];
      S.units = Array.isArray(r[2]) ? r[2] : [];
      renderUnits(); renderNews(); renderContent();
      loadRegs();
    });
  }

  // ---------- Điều hướng ----------
  $('#side-nav').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (!b) return;
    $$('#side-nav button').forEach(function (x) { x.classList.toggle('active', x === b); });
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + b.dataset.view; });
    if (b.dataset.view === 'tong-quan' || b.dataset.view === 'dang-ky') loadRegs();
    window.scrollTo(0, 0);
  });

  // ---------- Đăng ký ----------
  Object.keys(INTERESTS).forEach(function (k) { $('#regs-interest').insertAdjacentHTML('beforeend', '<option value="' + k + '">' + esc(INTERESTS[k]) + '</option>'); });
  Object.keys(STATUSES).forEach(function (k) { $('#regs-status').insertAdjacentHTML('beforeend', '<option value="' + k + '">' + esc(STATUSES[k]) + '</option>'); });

  function loadRegs() {
    return api('registrations').then(function (d) {
      S.regs = (d.items || []).slice().sort(function (a, b) { return String(b.thoiGian).localeCompare(String(a.thoiGian)); });
      renderRegs(); renderDashboard();
    }).catch(function (err) { toast(err.message, true); });
  }
  function filteredRegs() {
    var q = key($('#regs-q').value), it = $('#regs-interest').value, st = $('#regs-status').value;
    return S.regs.filter(function (r) {
      if (it && r.quanTam !== it) return false;
      if (st && r.trangThai !== st) return false;
      if (q && key([r.hoTen, r.dienThoai, r.email, r.loiNhan, r.ghiChu].join(' ')).indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderRegs() {
    var list = filteredRegs();
    $('#regs-count').textContent = list.length + ' / ' + S.regs.length + ' đăng ký';
    var body = $('#regs-table tbody');
    if (!list.length) { body.innerHTML = '<tr><td colspan="8" class="empty">Chưa có đăng ký nào phù hợp.</td></tr>'; return; }
    body.innerHTML = list.map(function (r) {
      var opts = Object.keys(STATUSES).map(function (k) { return '<option value="' + k + '"' + (r.trangThai === k ? ' selected' : '') + '>' + STATUSES[k] + '</option>'; }).join('');
      return '<tr data-id="' + esc(r.id) + '">' +
        '<td class="nowrap">' + fmtTime(r.thoiGian) + '</td>' +
        '<td><b>' + esc(r.hoTen) + '</b></td>' +
        '<td class="nowrap"><a href="tel:' + esc(String(r.dienThoai).replace(/[^0-9+]/g, '')) + '">' + esc(r.dienThoai) + '</a>' +
          (r.email ? '<br><a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : '') + '</td>' +
        '<td>' + esc(INTERESTS[r.quanTam] || r.quanTam) + '</td>' +
        '<td class="msg">' + esc(r.loiNhan) + '</td>' +
        '<td><select data-act="status">' + opts + '</select></td>' +
        '<td><input data-act="note" value="' + esc(r.ghiChu) + '" placeholder="Ghi chú…"></td>' +
        '<td class="row-actions"><button class="icon-btn del" data-act="del-reg" title="Xóa">Xóa</button></td></tr>';
    }).join('');
  }
  ['#regs-q', '#regs-interest', '#regs-status'].forEach(function (s) { $(s).addEventListener('input', renderRegs); });
  $('#regs-reload').addEventListener('click', function () { loadRegs().then(function () { toast('Đã tải lại danh sách.'); }); });
  function regById(id) { return S.regs.find(function (r) { return r.id === id; }); }
  $('#regs-table').addEventListener('change', function (e) {
    var tr = e.target.closest('tr[data-id]'); if (!tr) return;
    var r = regById(tr.dataset.id), payload = { id: r.id };
    if (e.target.dataset.act === 'status') payload.trangThai = e.target.value;
    else if (e.target.dataset.act === 'note') payload.ghiChu = e.target.value;
    else return;
    api('registration-update', { method: 'POST', type: 'application/json', body: JSON.stringify(payload) })
      .then(function () { Object.assign(r, payload); renderDashboard(); toast('Đã cập nhật.'); })
      .catch(function (err) { toast(err.message, true); });
  });
  $('#regs-table').addEventListener('click', function (e) {
    if (e.target.dataset.act !== 'del-reg') return;
    var r = regById(e.target.closest('tr').dataset.id);
    if (!confirm('Xóa đăng ký của "' + r.hoTen + '"? Không thể hoàn tác.')) return;
    api('registration-update', { method: 'POST', type: 'application/json', body: JSON.stringify({ id: r.id, xoa: true }) })
      .then(function () { S.regs = S.regs.filter(function (x) { return x !== r; }); renderRegs(); renderDashboard(); toast('Đã xóa.'); })
      .catch(function (err) { toast(err.message, true); });
  });
  $('#regs-export').addEventListener('click', function () {
    var rows = [['Thời gian', 'Họ tên', 'Điện thoại', 'Email', 'Nhu cầu', 'Lời nhắn', 'Trạng thái', 'Ghi chú']].concat(filteredRegs().map(function (r) {
      return [fmtTime(r.thoiGian), r.hoTen, r.dienThoai, r.email, INTERESTS[r.quanTam] || r.quanTam, r.loiNhan, STATUSES[r.trangThai] || r.trangThai, r.ghiChu];
    }));
    writeXlsx(rows, 'Đăng ký', 'dang-ky-tet-chay-an-lac-2027.xlsx', [18, 24, 14, 26, 22, 40, 12, 30]);
  });

  // ---------- Tổng quan ----------
  function renderDashboard() {
    var fresh = S.regs.filter(function (r) { return r.trangThai === 'moi'; }).length;
    var badge = $('#badge-new'); badge.hidden = !fresh; badge.textContent = fresh;
    var kp = [
      ['Tổng đăng ký', S.regs.length, ''], ['Đăng ký mới chưa xử lý', fresh, fresh ? 'warn' : ''],
      ['Đơn vị tham gia', S.units.length, ''], ['Đơn vị chưa có logo', S.units.filter(function (u) { return !u.logo && !S.pendingImg.units[u.id]; }).length, ''],
      ['Tin tức đã đăng', S.news.filter(function (n) { return !n.an; }).length, '']
    ];
    $('#kpis').innerHTML = kp.map(function (k) { return '<div class="kpi ' + k[2] + '"><b>' + k[1] + '</b><span>' + esc(k[0]) + '</span></div>'; }).join('');
    var counts = {}; S.regs.forEach(function (r) { counts[r.quanTam] = (counts[r.quanTam] || 0) + 1; });
    var max = Math.max.apply(null, [1].concat(Object.keys(counts).map(function (k) { return counts[k]; })));
    $('#kpi-interest').innerHTML = Object.keys(INTERESTS).map(function (k) {
      var n = counts[k] || 0;
      return '<div class="ibar"><span>' + esc(INTERESTS[k]) + '</span><i style="width:' + (n / max * 100) + '%"></i><b>' + n + '</b></div>';
    }).join('');
    var latest = S.regs.slice(0, 5);
    $('#latest-regs').innerHTML = latest.length ? '<div class="table-wrap"><table class="table"><tbody>' + latest.map(function (r) {
      return '<tr><td class="nowrap">' + fmtTime(r.thoiGian) + '</td><td><b>' + esc(r.hoTen) + '</b></td><td>' + esc(INTERESTS[r.quanTam] || r.quanTam) + '</td><td><span class="st st-' + esc(r.trangThai) + '">' + esc(STATUSES[r.trangThai] || r.trangThai) + '</span></td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="hint">Chưa có đăng ký nào.</p>';
  }

  // ---------- Excel ----------
  function writeXlsx(rows, sheet, filename, widths) {
    if (!window.XLSX) { toast('Chưa tải được thư viện Excel, kiểm tra kết nối mạng.', true); return; }
    var ws = XLSX.utils.aoa_to_sheet(rows);
    if (widths) ws['!cols'] = widths.map(function (w) { return { wch: w }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
    XLSX.writeFile(wb, filename);
  }
  function readSheet(file) {
    if (!window.XLSX) return Promise.reject(new Error('Chưa tải được thư viện Excel, kiểm tra kết nối mạng.'));
    var isCsv = /\.csv$/i.test(file.name);
    return (isCsv ? file.text() : file.arrayBuffer()).then(function (data) {
      var wb = XLSX.read(data, { type: isCsv ? 'string' : 'array' });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
    });
  }

  // ---------- Đơn vị tham gia ----------
  function splitList(v) {
    if (Array.isArray(v)) return v.map(function (s) { return String(s).trim(); }).filter(Boolean);
    return String(v || '').split(/[;\n|]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function normWeb(v) {
    v = String(v || '').trim();
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }
  function unitLogo(u) { return S.preview[u.id] || u.logo || ''; }
  function filteredUnits() {
    var q = key($('#units-q').value), ind = $('#units-industry').value, noLogo = $('#units-nologo').checked;
    return S.units.filter(function (u) {
      if (ind && u.nganh !== ind) return false;
      if (noLogo && unitLogo(u)) return false;
      if (q && key([u.ten, u.nganh, (u.sanPham || []).join(' '), u.khu, u.nguoiLienHe].join(' ')).indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderUnits() {
    var inds = Array.from(new Set(S.units.map(function (u) { return u.nganh; }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'vi'); });
    var sel = $('#units-industry'), cur = sel.value;
    sel.innerHTML = '<option value="">Mọi ngành nghề</option>' + inds.map(function (i) { return '<option' + (i === cur ? ' selected' : '') + '>' + esc(i) + '</option>'; }).join('');
    $('#industry-list').innerHTML = inds.map(function (i) { return '<option value="' + esc(i) + '">'; }).join('');
    var list = filteredUnits();
    $('#units-count').textContent = list.length + ' / ' + S.units.length + ' đơn vị';
    var body = $('#units-table tbody');
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">' + (S.units.length ? 'Không có đơn vị phù hợp bộ lọc.' : 'Chưa có đơn vị nào. Hãy nhập từ Excel hoặc bấm “+ Thêm đơn vị”.') + '</td></tr>';
    } else {
      body.innerHTML = list.map(function (u) {
        var logo = unitLogo(u);
        var thumb = logo ? '<div class="thumb' + (S.pendingImg.units[u.id] ? ' pending' : '') + '" style="background-image:url(&quot;' + esc(logo) + '&quot;)"></div>'
                         : '<div class="thumb" title="Chưa có logo">' + esc((u.ten || '?').trim().charAt(0).toUpperCase()) + '</div>';
        return '<tr data-id="' + esc(u.id) + '"' + (u.an ? ' class="muted"' : '') + '>' +
          '<td>' + thumb + '</td>' +
          '<td><b>' + esc(u.ten) + '</b>' + (u.diaChi ? '<br><small>' + esc(u.diaChi) + '</small>' : '') + '</td>' +
          '<td>' + esc(u.nganh) + '</td>' +
          '<td><div class="tags">' + (u.sanPham || []).slice(0, 4).map(function (p) { return '<span class="tag">' + esc(p) + '</span>'; }).join('') + ((u.sanPham || []).length > 4 ? '<span class="tag">+' + (u.sanPham.length - 4) + '</span>' : '') + '</div></td>' +
          '<td class="nowrap">' + esc(u.nguoiLienHe) + (u.dienThoai ? '<br>' + esc(u.dienThoai) : '') + (u.email ? '<br><small>' + esc(u.email) + '</small>' : '') + '</td>' +
          '<td>' + esc(u.khu) + '</td>' +
          '<td>' + (u.an ? 'Ẩn' : '✓') + '</td>' +
          '<td class="row-actions"><button class="icon-btn" data-act="edit">Sửa</button><button class="icon-btn del" data-act="del">Xóa</button></td></tr>';
      }).join('');
    }
    renderDashboard();
  }
  ['#units-q', '#units-industry', '#units-nologo'].forEach(function (s) { $(s).addEventListener('input', renderUnits); });

  function cleanUnit(raw) {
    var u = {};
    UNIT_COLUMNS.forEach(function (c) { u[c[0]] = c[0] === 'sanPham' ? splitList(raw.sanPham) : String(raw[c[0]] == null ? '' : raw[c[0]]).trim(); });
    u.website = normWeb(u.website);
    return u;
  }
  function report(html, warn) {
    var el = $('#units-report');
    el.hidden = false; el.className = 'import-report' + (warn ? ' warn' : '');
    el.innerHTML = html + ' <button class="link" type="button" onclick="this.parentNode.hidden=true">Đóng</button>';
  }

  $('#units-template').addEventListener('click', function () {
    writeXlsx([
      UNIT_COLUMNS.map(function (c) { return c[1]; }),
      ['Hợp tác xã Mẫu (DÒNG VÍ DỤ – XÓA TRƯỚC KHI NHẬP)', 'Nông sản hữu cơ', 'Gạo lứt; Đậu phụ non; Tương bần', 'Giới thiệu 1–2 câu về đơn vị', 'Nguyễn Văn A', '0900000000', 'lienhe@vidu.vn', 'facebook.com/vidu', 'Hà Nội', 'Khu D', 'hop-tac-xa-mau.png']
    ], 'Đơn vị tham gia', 'mau-don-vi-tham-gia.xlsx', [34, 20, 36, 36, 18, 14, 24, 26, 22, 14, 24]);
  });

  $('#units-import').addEventListener('change', function (e) {
    var file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    readSheet(file).then(function (rows) {
      var added = 0, updated = 0, skipped = [];
      rows.forEach(function (row, i) {
        var raw = {};
        Object.keys(row).forEach(function (h) { var f = HEADER_ALIASES[key(h)]; if (f && raw[f] == null) raw[f] = row[h]; });
        var u = cleanUnit(raw);
        if (!u.ten) { if (Object.keys(row).some(function (k) { return String(row[k]).trim(); })) skipped.push('Dòng ' + (i + 2) + ': thiếu tên đơn vị'); return; }
        if (/dòng ví dụ/i.test(u.ten)) { skipped.push('Dòng ' + (i + 2) + ': dòng ví dụ'); return; }
        var exist = S.units.find(function (x) { return key(x.ten) === key(u.ten); });
        if (exist) {
          Object.keys(u).forEach(function (k) { if (k === 'sanPham' ? u[k].length : u[k]) exist[k] = u[k]; });
          updated++;
        } else {
          u.id = uniqueId(u.ten, S.units); u.logo = ''; u.an = false;
          S.units.push(u); added++;
        }
      });
      if (!added && !updated && !skipped.length) { report('Không tìm thấy dữ liệu. Kiểm tra dòng tiêu đề có cột <b>Tên đơn vị</b>.', true); return; }
      setDirty('units', true); renderUnits();
      report('Đã nhập: <b>' + added + '</b> đơn vị mới, cập nhật <b>' + updated + '</b> đơn vị. Bấm <b>Lưu &amp; xuất bản</b> để đưa lên website.' +
        (skipped.length ? '<ul>' + skipped.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : ''), skipped.length > 0);
    }).catch(function (err) { toast('Không đọc được file: ' + err.message, true); });
  });

  $('#units-logos').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files); e.target.value = '';
    if (!files.length) return;
    var matched = [], unmatched = [];
    Promise.all(files.map(function (f) {
      var base = f.name.replace(/\.[^.]+$/, '');
      var u = S.units.find(function (x) { return x.logoFile && x.logoFile.toLowerCase() === f.name.toLowerCase(); }) ||
              S.units.find(function (x) { return x.logoFile && key(x.logoFile.replace(/\.[^.]+$/, '')) === key(base); }) ||
              S.units.find(function (x) { return key(x.ten) === key(base) || x.id === slug(base); });
      if (!u) { unmatched.push(f.name); return null; }
      return toWebp(f, 480).then(function (blob) {
        S.pendingImg.units[u.id] = blob; setPreview(u.id, blob); matched.push(f.name + ' → ' + u.ten);
      }).catch(function (err) { unmatched.push(f.name + ' (' + err.message + ')'); });
    })).then(function () {
      if (matched.length) setDirty('units', true);
      renderUnits();
      report('Đã ghép <b>' + matched.length + '</b> logo.' + (unmatched.length ? ' <b>' + unmatched.length + '</b> file không khớp đơn vị nào (đổi tên file trùng tên đơn vị, hoặc ghi vào cột “Tên file logo”):<ul>' +
        unmatched.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : ''), unmatched.length > 0);
    });
  });

  $('#units-add').addEventListener('click', function () { openUnit(null); });
  $('#units-table').addEventListener('click', function (e) {
    var act = e.target.dataset.act; if (!act) return;
    var u = S.units.find(function (x) { return x.id === e.target.closest('tr').dataset.id; });
    if (act === 'edit') openUnit(u);
    if (act === 'del' && confirm('Xóa đơn vị "' + u.ten + '"?')) {
      if (u.logo) S.removeFiles.units.push(fileNameOf(u.logo));
      delete S.pendingImg.units[u.id]; setPreview(u.id, null);
      S.units = S.units.filter(function (x) { return x !== u; });
      setDirty('units', true); renderUnits();
    }
  });
  $('#units-export').addEventListener('click', function () {
    writeXlsx([UNIT_COLUMNS.map(function (c) { return c[1]; })].concat(S.units.map(function (u) {
      return UNIT_COLUMNS.map(function (c) { return c[0] === 'sanPham' ? (u.sanPham || []).join('; ') : c[0] === 'logoFile' ? fileNameOf(u.logo) : (u[c[0]] || ''); });
    })), 'Đơn vị tham gia', 'don-vi-tham-gia-2027.xlsx', [34, 20, 36, 36, 18, 14, 24, 26, 22, 14, 24]);
  });

  // Hộp sửa đơn vị
  var unitDraft = null;
  function openUnit(u) {
    var f = $('#unit-form');
    unitDraft = { unit: u, blob: undefined, removeLogo: false };
    $('#unit-dlg-title').textContent = u ? 'Sửa đơn vị' : 'Thêm đơn vị';
    var v = u || {};
    ['ten', 'nganh', 'khu', 'moTa', 'nguoiLienHe', 'dienThoai', 'email', 'website', 'diaChi'].forEach(function (k) { f.elements[k].value = v[k] || ''; });
    f.elements.sanPham.value = (v.sanPham || []).join('\n');
    f.elements.an.checked = !!v.an;
    showUnitLogo(u ? unitLogo(u) : '');
    $('#unit-dlg').showModal();
  }
  function showUnitLogo(src) {
    var box = $('#unit-logo-preview');
    box.style.backgroundImage = src ? 'url("' + src.replace(/"/g, '%22') + '")' : '';
    box.textContent = src ? '' : 'Chưa có logo';
  }
  $('#unit-logo-input').addEventListener('change', function (e) {
    var file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    toWebp(file, 480).then(function (blob) {
      unitDraft.blob = blob; unitDraft.removeLogo = false;
      if (unitDraft.tmpUrl) URL.revokeObjectURL(unitDraft.tmpUrl);
      unitDraft.tmpUrl = URL.createObjectURL(blob); showUnitLogo(unitDraft.tmpUrl);
    }).catch(function (err) { toast(err.message, true); });
  });
  $('#unit-logo-remove').addEventListener('click', function () { unitDraft.blob = null; unitDraft.removeLogo = true; showUnitLogo(''); });
  // Xử lý ngay khi bấm nút trong hộp (sự kiện submit chạy đồng bộ, không phụ thuộc thời điểm hộp đóng)
  $('#unit-form').addEventListener('submit', function (e) {
    var f = $('#unit-form'), u = unitDraft.unit;
    if (!e.submitter || e.submitter.value !== 'ok') { if (unitDraft.tmpUrl) URL.revokeObjectURL(unitDraft.tmpUrl); return; }
    if (!f.elements.ten.value.trim()) { e.preventDefault(); f.elements.ten.focus(); toast('Vui lòng nhập tên đơn vị.', true); return; }
    var data = cleanUnit({
      ten: f.elements.ten.value, nganh: f.elements.nganh.value, khu: f.elements.khu.value, moTa: f.elements.moTa.value,
      nguoiLienHe: f.elements.nguoiLienHe.value, dienThoai: f.elements.dienThoai.value, email: f.elements.email.value,
      website: f.elements.website.value, diaChi: f.elements.diaChi.value, sanPham: f.elements.sanPham.value
    });
    delete data.logoFile;
    data.an = f.elements.an.checked;
    if (!u) { u = { id: uniqueId(data.ten, S.units), logo: '' }; S.units.push(u); }
    Object.assign(u, data);
    if (unitDraft.removeLogo) {
      if (u.logo) S.removeFiles.units.push(fileNameOf(u.logo));
      u.logo = ''; delete S.pendingImg.units[u.id]; setPreview(u.id, null);
    }
    if (unitDraft.blob) { S.pendingImg.units[u.id] = unitDraft.blob; setPreview(u.id, unitDraft.blob); }
    if (unitDraft.tmpUrl) URL.revokeObjectURL(unitDraft.tmpUrl);
    setDirty('units', true); renderUnits();
  });

  // ---------- Tin tức ----------
  function newsImg(n) { return S.preview['news:' + n.id] || n.anh || ''; }
  function renderNews() {
    var list = S.news.slice().sort(function (a, b) { return (b.ghim ? 1 : 0) - (a.ghim ? 1 : 0) || String(b.ngay).localeCompare(String(a.ngay)); });
    $('#news-list').innerHTML = list.length ? list.map(function (n) {
      var img = newsImg(n);
      return '<div class="news-item' + (n.an ? ' hidden-item' : '') + '" data-id="' + esc(n.id) + '">' +
        '<div class="img"' + (img ? ' style="background-image:url(&quot;' + esc(img) + '&quot;)"' : '') + '></div>' +
        '<div><h4>' + (n.ghim ? '<span class="pin">GHIM · </span>' : '') + esc(n.tieuDe) + (n.an ? ' <small>(đang ẩn)</small>' : '') + '</h4><p>' + esc(n.ngay) + ' · ' + esc(n.tomTat || String(n.noiDung || '').slice(0, 120)) + '</p></div>' +
        '<div class="row-actions"><button class="icon-btn" data-act="edit">Sửa</button><button class="icon-btn del" data-act="del">Xóa</button></div></div>';
    }).join('') : '<div class="panel"><p class="hint">Chưa có bài viết nào. Bấm “+ Viết tin mới”.</p></div>';
    renderDashboard();
  }
  var newsDraft = null;
  function openNews(n) {
    var now = new Date(), today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    var f = $('#news-form'), v = n || { ngay: today };
    newsDraft = { item: n, blob: undefined, remove: false };
    ['tieuDe', 'ngay', 'tomTat', 'noiDung'].forEach(function (k) { f.elements[k].value = v[k] || ''; });
    f.elements.ghim.checked = !!v.ghim; f.elements.an.checked = !!v.an;
    showNewsImg(n ? newsImg(n) : '');
    $('#news-dlg').showModal();
  }
  function showNewsImg(src) {
    var b = $('#news-img-preview');
    b.style.backgroundImage = src ? 'url("' + src.replace(/"/g, '%22') + '")' : '';
    b.textContent = src ? '' : 'Chưa có ảnh';
  }
  $('#news-add').addEventListener('click', function () { openNews(null); });
  $('#news-list').addEventListener('click', function (e) {
    var act = e.target.dataset.act; if (!act) return;
    var n = S.news.find(function (x) { return x.id === e.target.closest('[data-id]').dataset.id; });
    if (act === 'edit') openNews(n);
    if (act === 'del' && confirm('Xóa bài "' + n.tieuDe + '"?')) {
      if (n.anh) S.removeFiles.news.push(fileNameOf(n.anh));
      delete S.pendingImg.news[n.id]; setPreview('news:' + n.id, null);
      S.news = S.news.filter(function (x) { return x !== n; });
      setDirty('news', true); renderNews();
    }
  });
  $('#news-img-input').addEventListener('change', function (e) {
    var file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    toWebp(file, 1400).then(function (blob) {
      newsDraft.blob = blob; newsDraft.remove = false;
      if (newsDraft.tmpUrl) URL.revokeObjectURL(newsDraft.tmpUrl);
      newsDraft.tmpUrl = URL.createObjectURL(blob); showNewsImg(newsDraft.tmpUrl);
    }).catch(function (err) { toast(err.message, true); });
  });
  $('#news-img-remove').addEventListener('click', function () { newsDraft.blob = null; newsDraft.remove = true; showNewsImg(''); });
  $('#news-form').addEventListener('submit', function (e) {
    var f = $('#news-form'), n = newsDraft.item;
    if (!e.submitter || e.submitter.value !== 'ok') { if (newsDraft.tmpUrl) URL.revokeObjectURL(newsDraft.tmpUrl); return; }
    var title = f.elements.tieuDe.value.trim();
    if (!title) { e.preventDefault(); f.elements.tieuDe.focus(); toast('Bài viết cần có tiêu đề.', true); return; }
    if (!n) { n = { id: uniqueId(title, S.news), anh: '' }; S.news.push(n); }
    Object.assign(n, {
      tieuDe: title, ngay: f.elements.ngay.value, tomTat: f.elements.tomTat.value.trim(),
      noiDung: f.elements.noiDung.value.trim(), ghim: f.elements.ghim.checked, an: f.elements.an.checked
    });
    if (newsDraft.remove) {
      if (n.anh) S.removeFiles.news.push(fileNameOf(n.anh));
      n.anh = ''; delete S.pendingImg.news[n.id]; setPreview('news:' + n.id, null);
    }
    if (newsDraft.blob) { S.pendingImg.news[n.id] = newsDraft.blob; setPreview('news:' + n.id, newsDraft.blob); }
    if (newsDraft.tmpUrl) URL.revokeObjectURL(newsDraft.tmpUrl);
    setDirty('news', true); renderNews();
  });

  // ---------- Nội dung website ----------
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
  function setPath(o, p, v) {
    var ks = p.split('.'), last = ks.pop();
    var t = ks.reduce(function (a, k) { if (a[k] == null) a[k] = {}; return a[k]; }, o);
    t[last] = v;
  }
  function fld(label, path, opt) {
    opt = opt || {};
    var v = getPath(S.content, path), cls = opt.cls ? ' class="' + opt.cls + '"' : '';
    if (opt.type === 'bool') return '<label class="chk' + (opt.cls ? ' ' + opt.cls : '') + '"><input type="checkbox" data-path="' + path + '" data-type="bool"' + (v ? ' checked' : '') + '> ' + esc(label) + '</label>';
    if (opt.type === 'lines') return '<label' + cls + '>' + esc(label) + ' <small>(mỗi dòng một ý)</small><textarea data-path="' + path + '" data-type="lines" rows="' + (opt.rows || 4) + '">' + esc((v || []).join('\n')) + '</textarea></label>';
    if (opt.options) return '<label' + cls + '>' + esc(label) + '<select data-path="' + path + '">' + opt.options.map(function (o) { return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
    if (opt.rows) return '<label' + cls + '>' + esc(label) + '<textarea data-path="' + path + '" rows="' + opt.rows + '">' + esc(v || '') + '</textarea></label>';
    return '<label' + cls + '>' + esc(label) + '<input data-path="' + path + '" value="' + esc(v || '') + '"' + (opt.ph ? ' placeholder="' + esc(opt.ph) + '"' : '') + '></label>';
  }
  function rowBtns(path, i, n) {
    return '<span class="row-actions">' +
      (i > 0 ? '<button type="button" class="icon-btn" data-act="up" data-path="' + path + '" data-i="' + i + '" title="Lên">↑</button>' : '') +
      (i < n - 1 ? '<button type="button" class="icon-btn" data-act="down" data-path="' + path + '" data-i="' + i + '" title="Xuống">↓</button>' : '') +
      '<button type="button" class="icon-btn del" data-act="del" data-path="' + path + '" data-i="' + i + '">Xóa</button></span>';
  }
  function renderContent() {
    var c = S.content, h = '';
    h += '<div class="panel"><h3>Thông tin liên hệ</h3><div class="grid">' +
      fld('Hotline', 'lienHe.hotline', { ph: '09xx xxx xxx' }) + fld('Email', 'lienHe.email') +
      fld('Fanpage Facebook', 'lienHe.fanpage', { ph: 'https://facebook.com/…' }) + fld('Zalo (số hoặc link)', 'lienHe.zalo') +
      fld('Địa chỉ', 'lienHe.diaChi') + '</div></div>';
    h += '<div class="panel"><h3>Cổng đăng ký</h3>' + fld('Mở nhận đăng ký trên website', 'dangKyMo', { type: 'bool' }) +
      '<p class="hint">Bỏ chọn để đóng form đăng ký (ví dụ khi đã đủ gian hàng).</p></div>';
    h += '<div class="panel"><h3>Thông báo trên đầu website</h3><div class="grid">' +
      fld('Hiện thông báo', 'thongBao.bat', { type: 'bool' }) +
      fld('Kiểu', 'thongBao.kieu', { options: [['info', 'Thông tin (màu xanh)'], ['khan', 'Khẩn (màu cam)']] }) +
      fld('Đường dẫn khi bấm (không bắt buộc)', 'thongBao.lienKet', { ph: '#lich-trinh hoặc https://…' }) + '</div>' +
      fld('Nội dung thông báo', 'thongBao.noiDung', { rows: 2 }) + '</div>';
    // Lịch trình
    h += '<div class="panel"><h3>Lịch trình các ngày</h3>';
    (c.lichTrinh || []).forEach(function (d, i) {
      var p = 'lichTrinh.' + i;
      h += '<div class="sub"><div class="sub-head"><b>' + esc(d.nhan || 'Ngày ' + (i + 1)) + '</b>' + rowBtns('lichTrinh', i, c.lichTrinh.length) + '</div><div class="grid">' +
        fld('Nhãn trên nút chọn ngày', p + '.tab', { ph: 'T7 · 09/01' }) + fld('Nhãn nhỏ', p + '.nhan', { ph: 'Ngày 1' }) + fld('Chủ đề ngày', p + '.tieuDe') + '</div>';
      (d.muc || []).forEach(function (m, j) {
        var q = p + '.muc.' + j;
        h += '<div class="item-row">' + fld('Thời gian', q + '.gio') + fld('Hoạt động', q + '.ten') + fld('Mô tả', q + '.moTa', { rows: 2 }) +
          fld('Nổi bật', q + '.noiBat', { type: 'bool' }) + rowBtns(p + '.muc', j, d.muc.length) + '</div>';
      });
      h += '<button type="button" class="btn btn-sm" data-act="add" data-path="' + p + '.muc" data-tpl="item">+ Thêm hoạt động</button></div>';
    });
    h += '<p><button type="button" class="btn btn-sm" data-act="add" data-path="lichTrinh" data-tpl="day">+ Thêm ngày</button></p></div>';
    // Tài trợ
    h += '<div class="panel"><h3>Gói tài trợ tổng thể</h3>';
    (c.taiTro.tongThe || []).forEach(function (t, i) {
      var p = 'taiTro.tongThe.' + i;
      h += '<div class="sub"><div class="sub-head"><b>' + esc(t.ten || 'Gói mới') + '</b>' + rowBtns('taiTro.tongThe', i, c.taiTro.tongThe.length) + '</div><div class="grid">' +
        fld('Tên gói', p + '.ten') + fld('Mức kinh phí (VNĐ)', p + '.gia', { ph: '100.000.000' }) + fld('Mô tả ngắn', p + '.nhan') +
        fld('Màu', p + '.kieu', { options: [['diamond', 'Kim cương'], ['gold', 'Vàng'], ['silver', 'Bạc'], ['green', 'Xanh']] }) + '</div>' +
        fld('Quyền lợi', p + '.quyenLoi', { type: 'lines' }) + '</div>';
    });
    h += '<p><button type="button" class="btn btn-sm" data-act="add" data-path="taiTro.tongThe" data-tpl="tier">+ Thêm gói</button></p></div>';
    h += '<div class="panel"><h3>Tài trợ hạng mục chuyên đề</h3>';
    (c.taiTro.chuyenDe || []).forEach(function (t, i) {
      var p = 'taiTro.chuyenDe.' + i;
      h += '<div class="sub"><div class="sub-head"><b>' + esc(t.ten || 'Hạng mục mới') + '</b>' + rowBtns('taiTro.chuyenDe', i, c.taiTro.chuyenDe.length) + '</div><div class="grid">' +
        fld('Tên hạng mục', p + '.ten') + fld('Mức kinh phí (VNĐ)', p + '.gia') + '</div>' + fld('Quyền lợi chính', p + '.moTa', { rows: 2 }) + '</div>';
    });
    h += '<p><button type="button" class="btn btn-sm" data-act="add" data-path="taiTro.chuyenDe" data-tpl="topic">+ Thêm hạng mục</button></p></div>';
    $('#content-form').innerHTML = h;
  }
  $('#content-form').addEventListener('input', function (e) {
    var el = e.target, p = el.dataset.path; if (!p) return;
    var v = el.dataset.type === 'bool' ? el.checked
      : el.dataset.type === 'lines' ? el.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean)
      : el.value;
    setPath(S.content, p, v);
    setDirty('content', true);
  });
  $('#content-form').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var arr = getPath(S.content, b.dataset.path), i = +b.dataset.i;
    if (!Array.isArray(arr)) { arr = []; setPath(S.content, b.dataset.path, arr); }
    if (b.dataset.act === 'add') arr.push(TEMPLATES[b.dataset.tpl]());
    if (b.dataset.act === 'del') { if (!confirm('Xóa mục này?')) return; arr.splice(i, 1); }
    if (b.dataset.act === 'up') arr.splice(i - 1, 0, arr.splice(i, 1)[0]);
    if (b.dataset.act === 'down') arr.splice(i + 1, 0, arr.splice(i, 1)[0]);
    setDirty('content', true); renderContent();
  });

  // ---------- Lưu ----------
  // folder = khóa API ('logos' | 'news'), dir = thư mục thật trong data/
  function uploadPending(part, folder, dir, list, field, prefix) {
    var ids = Object.keys(S.pendingImg[part]);
    return ids.reduce(function (p, id) {
      return p.then(function () {
        var item = list.find(function (x) { return x.id === id; });
        if (!item) { delete S.pendingImg[part][id]; return; }
        var name = slug(id) + '-' + Date.now().toString(36) + '.webp';
        return api('upload', { method: 'POST', query: { folder: folder, name: name }, type: 'image/webp', body: S.pendingImg[part][id] }).then(function () {
          if (item[field]) S.removeFiles[part].push(fileNameOf(item[field]));
          item[field] = 'data/' + dir + '/' + name;
          delete S.pendingImg[part][id];
          setPreview(prefix + id, null);
        });
      });
    }, Promise.resolve());
  }
  function removeOld(part, folder) {
    var names = S.removeFiles[part].filter(Boolean); S.removeFiles[part] = [];
    return Promise.all(names.map(function (n) {
      return api('delete-file', { method: 'POST', query: { folder: folder, name: n } }).catch(function () {});
    }));
  }
  function save(part) {
    var btn = $('[data-save="' + part + '"]');
    btn.disabled = true; var label = btn.textContent; btn.textContent = 'Đang lưu…';
    var job;
    if (part === 'units') {
      job = uploadPending('units', 'logos', 'logos', S.units, 'logo', '').then(function () {
        var clean = S.units.map(function (u) { var o = Object.assign({}, u); delete o.logoFile; return o; });
        return api('save', { method: 'POST', query: { file: 'units' }, type: 'application/json', body: JSON.stringify(clean) });
      }).then(function () { return removeOld('units', 'logos'); });
    } else if (part === 'news') {
      job = uploadPending('news', 'news', 'tin-tuc', S.news, 'anh', 'news:').then(function () {
        return api('save', { method: 'POST', query: { file: 'news' }, type: 'application/json', body: JSON.stringify(S.news) });
      }).then(function () { return removeOld('news', 'news'); });
    } else {
      job = api('save', { method: 'POST', query: { file: 'content' }, type: 'application/json', body: JSON.stringify(S.content) });
    }
    job.then(function () {
      setDirty(part, false); toast('Đã lưu và xuất bản lên website.');
      if (part === 'units') renderUnits(); if (part === 'news') renderNews();
    }).catch(function (err) { toast('Chưa lưu được: ' + err.message, true); })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  }
  $$('[data-save]').forEach(function (b) { b.addEventListener('click', function () { save(b.dataset.save); }); });

  // ---------- Khởi động ----------
  var saved = load('ak');
  if (saved) {
    api('login', { pw: saved }).then(function () { S.key = saved; start(); }).catch(function () { logout(''); });
  }
})();
