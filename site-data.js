// Đọc dữ liệu do trang quản trị lưu (data/*.json) và hiển thị lên website.
// Nếu không đọc được dữ liệu, nội dung tĩnh sẵn có trong index.html vẫn được giữ nguyên.
(function () {
  'use strict';
  var PAGE = 12;

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Chỉ cho phép link http(s), mailto, tel, neo trong trang và file trong data/ hoặc img/
  function safeUrl(u) {
    u = String(u || '').trim();
    return /^(https?:\/\/|mailto:|tel:|#|data\/|img\/)/i.test(u) && !/\.\./.test(u) ? u : '';
  }
  function key(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function getJson(f, fallback) {
    return fetch('data/' + f, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : fallback; })
      .catch(function () { return fallback; });
  }
  function telHref(p) { return 'tel:' + String(p).replace(/[^0-9+]/g, ''); }
  function paragraphs(t) {
    return String(t || '').split(/\n\s*\n/).map(function (p) { return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }
  function dialogClose(dlg) {
    dlg.querySelector('.ud-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  }

  // ---------- Nội dung chung ----------
  function applyContent(c) {
    if (!c || typeof c !== 'object') return;

    // Liên hệ
    var lh = c.lienHe || {}, items = [];
    if (lh.hotline) items.push('<li><b>Hotline:</b> <a href="' + esc(telHref(lh.hotline)) + '">' + esc(lh.hotline) + '</a></li>');
    if (lh.email) items.push('<li><b>Email:</b> <a href="mailto:' + esc(lh.email) + '">' + esc(lh.email) + '</a></li>');
    if (safeUrl(lh.fanpage)) {
      var pageLabel = /facebook\.com/i.test(lh.fanpage) ? 'Tết Chay An Lạc trên Facebook' : lh.fanpage.replace(/^https?:\/\/(www\.)?/, '');
      items.push('<li><b>Fanpage:</b> <a href="' + esc(safeUrl(lh.fanpage)) + '" target="_blank" rel="noopener">' + esc(pageLabel) + '</a></li>');
    }
    if (lh.zalo) {
      var z = /^https?:/i.test(lh.zalo) ? lh.zalo : 'https://zalo.me/' + String(lh.zalo).replace(/[^0-9]/g, '');
      items.push('<li><b>Zalo:</b> <a href="' + esc(z) + '" target="_blank" rel="noopener">' + esc(lh.zalo) + '</a></li>');
    }
    if (lh.diaChi) items.push('<li><b>Địa chỉ:</b> ' + esc(lh.diaChi) + '</li>');
    if (items.length && $('#contact-list')) $('#contact-list').innerHTML = items.join('');

    // Thông báo đầu trang
    var tb = c.thongBao || {}, bar = $('#announce');
    if (bar && tb.bat && tb.noiDung) {
      var link = safeUrl(tb.lienKet);
      bar.className = 'announce announce-' + (tb.kieu === 'khan' ? 'khan' : 'info');
      bar.innerHTML = '<div class="container">' + (link ? '<a href="' + esc(link) + '">' + esc(tb.noiDung) + ' →</a>' : '<span>' + esc(tb.noiDung) + '</span>') + '</div>';
      bar.hidden = false;
    }

    // Đóng/mở cổng đăng ký
    var form = $('#reg-form');
    if (form && c.dangKyMo === false) {
      form.innerHTML = '<p class="reg-closed"><b>Cổng đăng ký đã đóng.</b><br>Cảm ơn sự quan tâm của bạn. Vui lòng liên hệ Ban Tổ chức qua thông tin bên cạnh.</p>';
    }

    // Liên hệ ở khung "Đơn vị tổ chức" và chân trang dùng cùng dữ liệu
    var orgList = $('.organizer-contact'), foot = $('.footer-contact');
    var fb = safeUrl(lh.fanpage);
    if (orgList && (lh.hotline || lh.email || fb)) {
      orgList.innerHTML =
        (lh.hotline ? '<li><span>Hotline</span><a href="' + esc(telHref(lh.hotline)) + '">' + esc(lh.hotline) + '</a></li>' : '') +
        (lh.email ? '<li><span>Email</span><a href="mailto:' + esc(lh.email) + '">' + esc(lh.email) + '</a></li>' : '') +
        (fb ? '<li><span>Fanpage</span><a href="' + esc(fb) + '" target="_blank" rel="noopener">' + esc(pageLabel) + '</a></li>' : '');
    }
    if (foot && (lh.hotline || lh.email || fb)) {
      foot.innerHTML = [
        lh.hotline ? 'Hotline <a href="' + esc(telHref(lh.hotline)) + '">' + esc(lh.hotline) + '</a>' : '',
        lh.email ? '<a href="mailto:' + esc(lh.email) + '">' + esc(lh.email) + '</a>' : '',
        fb ? '<a href="' + esc(fb) + '" target="_blank" rel="noopener">Fanpage</a>' : ''
      ].filter(Boolean).join(' · ');
    }

    renderSchedule(c.lichTrinh);
    renderSponsors(c.taiTro);
    renderSections(c);
  }

  // ---------- Các mục nội dung sửa được từ trang quản trị ----------
  function list(a) { return Array.isArray(a) ? a.filter(Boolean) : []; }
  function setText(sel, v) { var el = $(sel); if (el && v) el.textContent = v; }
  function setHead(id, d) {
    if (!d) return;
    setText('#' + id + ' .section-head h2', d.tieuDe);
    var lead = $('#' + id + ' .section-head .lead');
    if (lead && d.moTa) lead.textContent = d.moTa;
  }
  function fill(sel, items, fn) {
    var el = $(sel), arr = list(items);
    if (el && arr.length) el.innerHTML = arr.map(fn).join('');
  }
  function slugId(s, i) {
    var k = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return 'muc-' + (k || i);
  }

  function renderSections(c) {
    // Đầu trang
    var h = c.hero;
    if (h) {
      setText('.hero .eyebrow', h.nhanTren);
      var h1 = $('.hero h1');
      if (h1 && (h.tieuDe1 || h.tieuDe2)) h1.innerHTML = esc(h.tieuDe1) + (h.tieuDe2 ? '<br><em>' + esc(h.tieuDe2) + '</em>' : '');
      setText('#hero-time', h.thoiGian);
      setText('#hero-place', h.diaDiem);
      fill('#hero-stats', h.thongKe, function (s) { return '<div><b>' + esc(s.so) + '</b><span>' + esc(s.nhan) + '</span></div>'; });
      if (window.setFestivalDates && h.batDau) window.setFestivalDates(h.batDau, h.ketThuc);
    }

    // 1. Giới thiệu
    setHead('gioi-thieu', c.gioiThieu);
    if (c.gioiThieu) fill('#gioi-thieu .aims', c.gioiThieu.mucDich, function (m, i) {
      return '<article class="aim"><span class="aim-num">' + String(i + 1).padStart(2, '0') + '</span><h3>' + esc(m.tieuDe) + '</h3><p>' + esc(m.moTa) + '</p></article>';
    });
    if (c.toChuc) {
      setText('.organizer-label', c.toChuc.nhan);
      setText('.organizer-name', c.toChuc.ten);
      var sub = $('.organizer-partners');
      if (sub) { sub.textContent = c.toChuc.phu || ''; sub.hidden = !c.toChuc.phu; }
    }

    // 2. Tổng quan
    setHead('tong-quan', c.tongQuan);
    if (c.tongQuan) fill('#tong-quan .overview', c.tongQuan.truong, function (r) {
      return '<div><dt>' + esc(r.nhan) + '</dt><dd>' + esc(r.giaTri) + (r.ghiChu ? '<small>' + esc(r.ghiChu) + '</small>' : '') + '</dd></div>';
    });
    fill('#tong-quan .zones3', c.phanKhu, function (z) {
      return '<article class="card"><h3>' + (z.nhan ? '<small>' + esc(z.nhan) + '</small>' : '') + esc(z.ten) + '</h3><p>' + esc(z.moTa) + '</p></article>';
    });
    fill('#tong-quan .stages', c.sanKhau, function (z) { return '<article class="card"><h3>' + esc(z.ten) + '</h3><p>' + esc(z.moTa) + '</p></article>'; });

    // 3. Bản đồ
    var bd = c.banDo;
    if (bd) {
      setHead('ban-do', bd);
      var toaDo = String(bd.toaDo || '').replace(/\s+/g, '');
      if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(toaDo)) {
        var fr = $('#ban-do iframe'), dir = $('#map-dir');
        if (fr) fr.src = 'https://maps.google.com/maps?q=' + toaDo + '&z=16&output=embed';
        if (dir) dir.href = 'https://www.google.com/maps/dir/?api=1&destination=' + toaDo;
      }
      var b3 = $('#map-3d'), l3 = safeUrl(bd.link3D);
      if (b3) { if (l3) b3.href = l3; b3.hidden = !l3; }
      fill('#ban-do .map-info ul', bd.thongTin, function (t) { return '<li>' + (t.nhan ? '<b>' + esc(t.nhan) + ':</b> ' : '') + esc(t.noiDung) + '</li>'; });
    }

    // 4. Sơ đồ gian hàng
    var sd = c.soDo;
    if (sd) {
      setHead('so-do', sd);
      var anh = safeUrl(sd.anh);
      if (anh) {
        var img = $('#so-do .booth-map img');
        if (img && img.getAttribute('src') !== anh) { img.removeAttribute('width'); img.removeAttribute('height'); img.src = anh; }
        Array.prototype.forEach.call(document.querySelectorAll('#so-do a[href]'), function (a) { a.href = anh; });
      }
      fill('#so-do .booth-legend', sd.chuThich, function (l) {
        var mau = /^#[0-9a-f]{3,8}$/i.test(l.mau || '') ? l.mau : '#7a9a01';
        return '<li><i style="background:' + mau + '"></i><b>' + esc(l.nhan) + '</b> ' + esc(l.moTa) + '</li>';
      });
    }

    // 5. Hoạt động chính
    if (c.hoatDong) {
      setHead('lich-trinh', c.hoatDong);
      fill('#lich-trinh .activities', c.hoatDong.khac, function (a) { return '<article class="card"><h3>' + esc(a.tieuDe) + '</h3><p>' + esc(a.moTa) + '</p></article>'; });
    }

    // 6. Tiêu chí
    if (c.tieuChi) {
      setHead('tieu-chi', c.tieuChi);
      fill('#tieu-chi .criteria', c.tieuChi.nhom, function (g) {
        return '<article class="criterion"><h3>' + esc(g.tieuDe) + '</h3><ul>' + list(g.muc).map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></article>';
      });
    }

    // 7. Các kỳ
    if (c.cacKy) {
      setHead('cac-ky', c.cacKy);
      fill('#cac-ky .editions', c.cacKy.ky, function (k) {
        return '<li class="edition' + (k.hienTai ? ' current' : '') + '">' + (k.nhan ? '<span class="edition-tag">' + esc(k.nhan) + '</span>' : '') +
          '<h3>' + esc(k.ten) + '</h3>' + (k.diaDiem ? '<p class="edition-place">' + esc(k.diaDiem) + '</p>' : '') + (k.moTa ? '<p class="muted">' + esc(k.moTa) + '</p>' : '') + '</li>';
      });
    }

    // Mục tùy chỉnh (thêm mới từ trang quản trị)
    var box = $('#muc-tuy-chinh'), nav = $('#main-nav'), before = nav && nav.querySelector('a[href="#don-vi"]');
    var mucs = list(c.mucTuyChinh).filter(function (m) { return !m.an && (m.tieuDe || m.moTa); });
    if (box && mucs.length) {
      box.innerHTML = mucs.map(function (m, i) {
        var id = slugId(m.tieuDe, i);
        if (nav && m.menu && before) {
          var a = document.createElement('a'); a.href = '#' + id; a.textContent = m.menu; nav.insertBefore(a, before);
        }
        var link = safeUrl(m.lienKet);
        return '<section id="' + id + '" class="section custom-section' + (i % 2 ? '' : ' section-tint') + '"><div class="container">' +
          '<div class="section-head">' + (m.nhan ? '<p class="eyebrow">' + esc(m.nhan) + '</p>' : '') + '<h2>' + esc(m.tieuDe) + '</h2>' +
          (m.moTa ? '<div class="lead">' + paragraphs(m.moTa) + '</div>' : '') + '</div>' +
          (list(m.dong).length ? '<ul class="custom-list">' + list(m.dong).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') +
          (link ? '<p><a class="btn btn-primary" href="' + esc(link) + '"' + (/^https?:/i.test(link) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(m.nutChu || 'Xem thêm') + '</a></p>' : '') +
          '</div></section>';
      }).join('');
    }
  }

  function renderSchedule(days) {
    var tabs = $('#lich-trinh .tabs'), panels = $('#lich-trinh .tab-panels');
    if (!Array.isArray(days) || !days.length || !tabs || !panels) return;
    tabs.innerHTML = days.map(function (d, i) {
      return '<button role="tab" id="tab' + (i + 1) + '" aria-controls="day' + (i + 1) + '" aria-selected="' + (i === 0) + '"' + (i ? ' tabindex="-1"' : '') + '>' + esc(d.tab || d.nhan || 'Ngày ' + (i + 1)) + '</button>';
    }).join('');
    panels.innerHTML = days.map(function (d, i) {
      return '<div class="day" role="tabpanel" id="day' + (i + 1) + '" aria-labelledby="tab' + (i + 1) + '"' + (i ? ' hidden' : '') + '>' +
        '<h3><span>' + esc(d.nhan) + '</span>' + esc(d.tieuDe) + '</h3><ol class="timeline">' +
        (d.muc || []).map(function (m) {
          return '<li' + (m.noiBat ? ' class="hl"' : '') + '><time>' + esc(m.gio) + '</time><div><b>' + esc(m.ten) + '</b>' + (m.moTa ? '<p>' + esc(m.moTa) + '</p>' : '') + '</div></li>';
        }).join('') + '</ol></div>';
    }).join('');
    var btns = Array.prototype.slice.call(tabs.querySelectorAll('[role="tab"]'));
    function select(b) {
      btns.forEach(function (t) {
        var on = t === b;
        t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
    }
    btns.forEach(function (b, i) {
      b.addEventListener('click', function () { select(b); });
      b.addEventListener('keydown', function (e) {
        var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
        if (j === null) return;
        var n = btns[(j + btns.length) % btns.length]; select(n); n.focus();
      });
    });
    var today = Math.floor((Date.now() - new Date('2026-12-24T00:00:00+07:00').getTime()) / 86400000);
    if (today >= 0 && today < btns.length) select(btns[today]);
  }

  function renderSponsors(t) {
    if (!t) return;
    var tiers = $('#tai-tro .tiers'), topics = $('#tai-tro .topic-sponsors');
    if (tiers && Array.isArray(t.tongThe) && t.tongThe.length) {
      tiers.innerHTML = t.tongThe.map(function (g) {
        var kieu = ['diamond', 'gold', 'silver', 'green'].indexOf(g.kieu) >= 0 ? g.kieu : 'green';
        return '<article class="tier tier-' + kieu + '"><p class="tier-name">' + esc(g.ten) + '</p>' +
          '<p class="tier-price">' + esc(g.gia) + '<small>VNĐ</small></p><p class="tier-tag">' + esc(g.nhan) + '</p>' +
          '<ul>' + (g.quyenLoi || []).map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul></article>';
      }).join('');
    }
    if (topics && Array.isArray(t.chuyenDe) && t.chuyenDe.length) {
      topics.innerHTML = t.chuyenDe.map(function (g) {
        return '<div><b>' + esc(g.ten) + '</b><span>' + esc(g.gia) + ' VNĐ</span><p>' + esc(g.moTa) + '</p></div>';
      }).join('');
    }
  }

  // ---------- Đơn vị tham gia ----------
  function renderUnits(all) {
    var grid = $('#units-grid'); if (!grid) return;
    var units = (Array.isArray(all) ? all : []).filter(function (u) { return u && u.ten && !u.an; })
      .sort(function (a, b) { return a.ten.localeCompare(b.ten, 'vi'); });
    var empty = $('#units-empty'), more = $('#units-more'), count = $('#units-count');
    var filterBox = $('#unit-filters'), search = $('#unit-search');
    if (!units.length) { empty.hidden = false; $('.units-tools').hidden = true; return; }
    empty.hidden = true;

    var inds = {};
    units.forEach(function (u) { if (u.nganh) inds[u.nganh] = (inds[u.nganh] || 0) + 1; });
    var names = Object.keys(inds).sort(function (a, b) { return a.localeCompare(b, 'vi'); });
    filterBox.innerHTML = '<button type="button" class="chip active" data-ind="">Tất cả <small>' + units.length + '</small></button>' +
      names.map(function (n) { return '<button type="button" class="chip" data-ind="' + esc(n) + '">' + esc(n) + ' <small>' + inds[n] + '</small></button>'; }).join('');
    if (names.length < 2) filterBox.hidden = true;

    var state = { ind: '', q: '', shown: PAGE };
    function list() {
      var q = key(state.q);
      return units.filter(function (u) {
        if (state.ind && u.nganh !== state.ind) return false;
        if (q && key([u.ten, u.nganh, (u.sanPham || []).join(' '), u.khu].join(' ')).indexOf(q) < 0) return false;
        return true;
      });
    }
    function card(u, i) {
      var logo = safeUrl(u.logo);
      return '<button type="button" class="unit-card" data-i="' + i + '">' +
        '<span class="unit-logo">' + (logo ? '<img src="' + esc(logo) + '" alt="" loading="lazy">' : '<span class="unit-initial">' + esc(u.ten.trim().charAt(0).toUpperCase()) + '</span>') + '</span>' +
        '<span class="unit-name">' + esc(u.ten) + '</span>' +
        (u.nganh ? '<span class="unit-ind">' + esc(u.nganh) + '</span>' : '') +
        ((u.sanPham || []).length ? '<span class="unit-tags">' + u.sanPham.slice(0, 3).map(function (p) { return '<i>' + esc(p) + '</i>'; }).join('') + '</span>' : '') +
        (u.khu ? '<span class="unit-zone">Gian hàng ' + esc(u.khu) + '</span>' : '') + '</button>';
    }
    var current = [];
    function draw() {
      current = list();
      grid.innerHTML = current.slice(0, state.shown).map(card).join('') ||
        '<p class="units-none">Không tìm thấy đơn vị phù hợp.</p>';
      more.hidden = current.length <= state.shown;
      count.textContent = current.length === units.length ? units.length + ' đơn vị tham gia' : current.length + ' / ' + units.length + ' đơn vị';
    }
    filterBox.addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      Array.prototype.forEach.call(filterBox.children, function (c) { c.classList.toggle('active', c === b); });
      state.ind = b.dataset.ind; state.shown = PAGE; draw();
    });
    search.addEventListener('input', function () { state.q = search.value; state.shown = PAGE; draw(); });
    more.addEventListener('click', function () { state.shown += PAGE; draw(); });

    var dlg = $('#unit-dialog'); dialogClose(dlg);
    grid.addEventListener('click', function (e) {
      var c = e.target.closest('.unit-card'); if (!c) return;
      var u = current[+c.dataset.i], logo = safeUrl(u.logo), web = safeUrl(u.website), rows = [];
      if (u.nguoiLienHe) rows.push(['Người liên hệ', esc(u.nguoiLienHe)]);
      if (u.dienThoai) rows.push(['Điện thoại', '<a href="' + esc(telHref(u.dienThoai)) + '">' + esc(u.dienThoai) + '</a>']);
      if (u.email) rows.push(['Email', '<a href="mailto:' + esc(u.email) + '">' + esc(u.email) + '</a>']);
      if (web) rows.push(['Website', '<a href="' + esc(web) + '" target="_blank" rel="noopener">' + esc(web.replace(/^https?:\/\/(www\.)?/, '')) + '</a>']);
      if (u.diaChi) rows.push(['Địa chỉ', esc(u.diaChi)]);
      if (u.khu) rows.push(['Gian hàng', esc(u.khu)]);
      $('#ud-body').innerHTML =
        '<div class="ud-head">' + (logo ? '<img src="' + esc(logo) + '" alt="Logo ' + esc(u.ten) + '">' : '<span class="unit-initial big">' + esc(u.ten.trim().charAt(0).toUpperCase()) + '</span>') +
        '<div><h3 id="ud-name">' + esc(u.ten) + '</h3>' + (u.nganh ? '<p class="unit-ind">' + esc(u.nganh) + '</p>' : '') + '</div></div>' +
        (u.moTa ? '<p class="ud-desc">' + esc(u.moTa) + '</p>' : '') +
        ((u.sanPham || []).length ? '<h4>Sản phẩm tiêu biểu</h4><ul class="ud-products">' + u.sanPham.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
        (rows.length ? '<h4>Liên hệ</h4><dl class="ud-contact">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>' : '');
      dlg.showModal();
    });
    draw();
  }

  // ---------- Tin tức ----------
  function renderNews(all) {
    var items = (Array.isArray(all) ? all : []).filter(function (n) { return n && n.tieuDe && !n.an; })
      .sort(function (a, b) { return (b.ghim ? 1 : 0) - (a.ghim ? 1 : 0) || String(b.ngay).localeCompare(String(a.ngay)); });
    if (!items.length) return;
    $('#tin-tuc').hidden = false;
    if ($('#nav-news')) $('#nav-news').hidden = false;
    function date(d) { var p = String(d || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : esc(d); }
    $('#news-grid').innerHTML = items.slice(0, 6).map(function (n, i) {
      var img = safeUrl(n.anh);
      return '<button type="button" class="news-card' + (i === 0 ? ' first' : '') + '" data-i="' + i + '">' +
        (img ? '<span class="news-img"><img src="' + esc(img) + '" alt="" loading="lazy"></span>' : '') +
        '<span class="news-body"><time>' + date(n.ngay) + (n.ghim ? ' · Ghim' : '') + '</time><b>' + esc(n.tieuDe) + '</b>' +
        '<span>' + esc(n.tomTat || String(n.noiDung || '').slice(0, 160)) + '</span><em>Đọc tiếp →</em></span></button>';
    }).join('');
    var dlg = $('#news-dialog'); dialogClose(dlg);
    $('#news-grid').addEventListener('click', function (e) {
      var c = e.target.closest('.news-card'); if (!c) return;
      var n = items[+c.dataset.i], img = safeUrl(n.anh);
      $('#nd-body').innerHTML = (img ? '<img class="nd-img" src="' + esc(img) + '" alt="">' : '') +
        '<time class="nd-date">' + date(n.ngay) + '</time><h3 id="nd-title">' + esc(n.tieuDe) + '</h3>' +
        (n.tomTat ? '<p class="ud-desc"><b>' + esc(n.tomTat) + '</b></p>' : '') + '<div class="nd-content">' + paragraphs(n.noiDung) + '</div>';
      dlg.showModal();
    });
  }

  Promise.all([getJson('content.json', null), getJson('don-vi.json', []), getJson('tin-tuc.json', [])]).then(function (r) {
    try { applyContent(r[0]); } catch (e) { console.error(e); }
    try { renderUnits(r[1]); } catch (e) { console.error(e); }
    try { renderNews(r[2]); } catch (e) { console.error(e); }
  });
})();
