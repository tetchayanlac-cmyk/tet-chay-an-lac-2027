/* Module "Đăng bài MXH" – giao diện quản lý (tetchayanlac.com/dang-bai/) */
(function () {
  'use strict';

  var S = { me: null, csrf: '', platforms: {}, connected: {}, dryRun: false, posts: [], filter: 'all', timer: null };
  var app = document.getElementById('app');

  var STATUS = {
    draft: 'Nháp', pending: 'Chờ duyệt', rejected: 'Bị trả lại', approved: 'Đã duyệt · chờ đến giờ',
    publishing: 'Đang đăng', done: 'Đã đăng', partial: 'Đăng một phần', failed: 'Đăng lỗi'
  };
  var RES = { waiting: 'chờ', processing: 'đang xử lý', done: 'đã đăng', failed: 'lỗi' };
  var CHUNK = 4 * 1024 * 1024;

  /* ---------- tiện ích ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function fmt(ts) {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function toLocalInput(ts) {
    var d = new Date(ts * 1000), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function size(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  var toastT;
  function toast(msg, bad) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = ''; }, bad ? 6000 : 3000);
  }

  function api(action, body, method) {
    var opt = { method: method || (body ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
    if (body instanceof FormData) opt.body = body;
    else if (body) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    if (opt.method === 'POST') opt.headers['X-CSRF'] = S.csrf;
    return fetch('api.php?action=' + action, opt).then(function (r) {
      return r.json().catch(function () { return { error: 'Máy chủ trả về lỗi (' + r.status + ').' }; }).then(function (d) {
        if (r.status === 401 && action !== 'login') { S.me = null; renderLogin(); }
        if (!r.ok || d.error) throw new Error(d.error || ('Lỗi ' + r.status));
        return d;
      });
    });
  }

  function modal(title, fields, okText) {
    return new Promise(function (resolve) {
      var inputs = {};
      var bg = h('div', { class: 'modal-bg' });
      var form = h('form', { class: 'modal' }, h('h3', { text: title }));
      fields.forEach(function (f) {
        var inp = f.type === 'textarea'
          ? h('textarea', { rows: 4, placeholder: f.placeholder || '' })
          : h('input', { type: f.type || 'text', placeholder: f.placeholder || '', autocomplete: f.autocomplete || 'off' });
        if (f.value) inp.value = f.value;
        inputs[f.name] = inp;
        form.appendChild(h('label', { class: 'f' }, h('span', { text: f.label }), inp));
      });
      var close = function (v) { document.body.removeChild(bg); resolve(v); };
      form.appendChild(h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', text: 'Hủy', onclick: function () { close(null); } }),
        h('button', { type: 'submit', class: 'btn primary', text: okText || 'Đồng ý' })));
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var out = {}; Object.keys(inputs).forEach(function (k) { out[k] = inputs[k].value; });
        close(out);
      });
      bg.addEventListener('click', function (e) { if (e.target === bg) close(null); });
      bg.appendChild(form); document.body.appendChild(bg);
      var first = form.querySelector('input,textarea'); if (first) first.focus();
    });
  }
  function confirmBox(msg) { return modal(msg, [], 'Đồng ý').then(function (v) { return !!v; }); }

  /* ---------- khởi động ---------- */
  function boot() {
    api('me').then(function (d) {
      if (!d.user) return renderLogin();
      S.me = d.user; S.csrf = d.csrf; S.platforms = d.platforms; S.connected = d.connected; S.dryRun = d.dryRun;
      if (d.flash) setTimeout(function () { toast(d.flash.msg, !d.flash.ok); }, 300);
      route();
    }).catch(function (e) { clear(app).appendChild(h('p', { class: 'boot', text: e.message })); });
  }
  window.addEventListener('hashchange', function () { if (S.me) route(); });

  function renderLogin() {
    clearInterval(S.timer);
    var err = h('p', { class: 'err' });
    var u = h('input', { type: 'text', autocomplete: 'username', placeholder: 'Tên đăng nhập' });
    var p = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Mật khẩu' });
    var btn = h('button', { type: 'submit', class: 'btn primary', text: 'Đăng nhập' });
    var form = h('form', { class: 'login' },
      h('img', { src: '../logo-tcal-180.png', alt: '' }),
      h('h1', { text: 'Đăng bài mạng xã hội' }),
      h('p', { class: 'sub', text: 'Tết Chay An Lạc · khu vực nội bộ' }),
      h('label', { class: 'f' }, h('span', { text: 'Tên đăng nhập' }), u),
      h('label', { class: 'f' }, h('span', { text: 'Mật khẩu' }), p),
      err, btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      api('login', { username: u.value, password: p.value })
        .then(function () { location.hash = ''; boot(); })
        .catch(function (x) { err.textContent = x.message; btn.disabled = false; });
    });
    clear(app).appendChild(form); u.focus();
  }

  function isAdmin() { return S.me && S.me.role === 'admin'; }

  function shell(active) {
    var pending = S.posts.filter(function (p) { return p.status === 'pending'; }).length;
    var tabs = [['bai', 'Tất cả bài đăng']];
    if (isAdmin()) tabs.unshift(['cho-duyet', 'Chờ duyệt']);
    tabs.push(['soan', '+ Soạn bài mới']);
    if (isAdmin()) tabs.push(['ket-noi', 'Kết nối tài khoản'], ['nhan-vien', 'Tài khoản nhân viên'], ['nhat-ky', 'Nhật ký']);
    var main = h('main');
    clear(app).appendChild(h('div', null,
      h('header', { class: 'top' }, h('div', { class: 'top-in' },
        h('a', { class: 'brand', href: '#' }, h('img', { src: '../logo-tcal-180.png', alt: '' }), 'Đăng bài MXH'),
        h('div', { class: 'who' },
          h('span', { text: S.me.name || S.me.username }),
          h('span', { class: 'role', text: isAdmin() ? 'Quản trị' : 'Nhân viên' }),
          h('button', { type: 'button', text: 'Đổi mật khẩu', onclick: changePassword }),
          h('button', { type: 'button', text: 'Đăng xuất', onclick: logout })))),
      h('nav', { class: 'tabs' }, h('div', { class: 'tabs-in' }, tabs.map(function (t) {
        return h('a', { href: '#' + t[0], class: active === t[0] ? 'on' : '' }, t[1],
          t[0] === 'cho-duyet' && pending ? h('span', { class: 'count', text: pending }) : null);
      }))),
      S.dryRun ? h('div', { class: 'banner warn', style: 'max-width:1180px;margin:12px auto 0' },
        'Đang bật CHẾ ĐỘ CHẠY THỬ: bài được duyệt sẽ chỉ giả lập là đã đăng, không đăng thật lên mạng xã hội.') : null,
      main));
    return main;
  }

  function logout() { api('logout', {}).finally(function () { S.me = null; location.hash = ''; renderLogin(); }); }

  function changePassword() {
    modal('Đổi mật khẩu', [
      { name: 'old', label: 'Mật khẩu hiện tại', type: 'password', autocomplete: 'current-password' },
      { name: 'new', label: 'Mật khẩu mới (ít nhất 8 ký tự)', type: 'password', autocomplete: 'new-password' }
    ], 'Đổi mật khẩu').then(function (v) {
      if (!v) return;
      api('password', v).then(function () { toast('Đã đổi mật khẩu.'); }).catch(function (e) { toast(e.message, true); });
    });
  }

  function loadPosts() {
    return api('posts').then(function (d) { S.posts = d.posts; });
  }

  function route() {
    clearInterval(S.timer);
    var hash = location.hash.replace(/^#/, '');
    var parts = hash.split('/');
    var view = parts[0] || (isAdmin() ? 'cho-duyet' : 'bai');
    if (!isAdmin() && ['cho-duyet', 'ket-noi', 'nhan-vien', 'nhat-ky'].indexOf(view) >= 0) view = 'bai';
    loadPosts().then(function () {
      if (view === 'soan') return viewCompose(parts[1] ? +parts[1] : 0);
      if (view === 'ket-noi') return viewSettings();
      if (view === 'nhan-vien') return viewUsers();
      if (view === 'nhat-ky') return viewLog();
      viewList(view);
    }).catch(function (e) { toast(e.message, true); });
  }

  /* ---------- danh sách bài ---------- */
  function viewList(view) {
    var main = shell(view);
    var onlyPending = view === 'cho-duyet';
    var list = h('div', { class: 'posts' });
    var filters = [['all', 'Tất cả'], ['draft', 'Nháp'], ['pending', 'Chờ duyệt'], ['approved', 'Chờ đến giờ'],
      ['publishing', 'Đang đăng'], ['done', 'Đã đăng'], ['problem', 'Lỗi / Bị trả lại']];
    main.appendChild(h('h2', { text: onlyPending ? 'Bài đang chờ duyệt' : 'Tất cả bài đăng' }));
    if (onlyPending) main.appendChild(h('p', { class: 'hint', text: 'Duyệt bài để hệ thống tự đăng đồng loạt lên các tài khoản đã chọn vào đúng thời gian hẹn. Bài không hẹn giờ sẽ đăng ngay sau khi duyệt.' }));
    else main.appendChild(h('div', { class: 'filters' }, filters.map(function (f) {
      return h('button', { type: 'button', class: 'chip' + (S.filter === f[0] ? ' on' : ''), text: f[1],
        onclick: function () { S.filter = f[0]; viewList(view); } });
    })));
    main.appendChild(list);
    function draw() {
      clear(list);
      var items = S.posts.filter(function (p) {
        if (onlyPending) return p.status === 'pending';
        if (S.filter === 'all') return true;
        if (S.filter === 'problem') return ['failed', 'partial', 'rejected'].indexOf(p.status) >= 0;
        return p.status === S.filter;
      });
      if (!items.length) list.appendChild(h('div', { class: 'empty' }, onlyPending ? 'Không có bài nào đang chờ duyệt.' : 'Chưa có bài đăng nào.',
        h('div', { style: 'margin-top:12px' }, h('a', { class: 'btn primary', href: '#soan', text: '+ Soạn bài mới' }))));
      items.forEach(function (p) { list.appendChild(postCard(p, view)); });
    }
    draw();
    // Tự cập nhật trạng thái khi có bài đang đăng
    S.timer = setInterval(function () {
      if (!S.posts.some(function (p) { return p.status === 'publishing' || p.status === 'approved'; })) return;
      loadPosts().then(draw).catch(function () {});
    }, 20000);
  }

  function postCard(p, view) {
    var mine = p.author === S.me.id;
    var media = h('div', { class: 'media' });
    if (p.mediaType === 'video') media.appendChild(h('video', { src: p.mediaUrl, controls: true, preload: 'metadata', playsinline: true }));
    else if (p.mediaType === 'image') media.appendChild(h('img', { src: p.mediaUrl, alt: '', loading: 'lazy' }));
    else media.appendChild(h('div', { class: 'none', text: 'Bài chữ (không có video/ảnh)' }));

    var cap = h('div', { class: 'cap', text: p.caption || '' });
    var more = p.caption && p.caption.length > 260 ? h('button', { type: 'button', class: 'more', text: 'Xem thêm',
      onclick: function () { cap.classList.toggle('open'); more.textContent = cap.classList.contains('open') ? 'Thu gọn' : 'Xem thêm'; } }) : null;

    var plats = h('div', { class: 'plats' });
    var errs = [];
    p.platforms.forEach(function (k) {
      var r = p.results && p.results[k];
      var st = r ? r.status : '';
      var label = [h('span', { class: 'dot' }), S.platforms[k] || k];
      if (r) label.push(h('small', { text: ' · ' + RES[st] }));
      plats.appendChild(r && r.url ? h('a', { class: 'plat ' + st, href: r.url, target: '_blank', rel: 'noopener' }, label) : h('span', { class: 'plat ' + st }, label));
      if (r && st === 'failed') errs.push(h('div', { class: 'plat-err' }, S.platforms[k] + ': ' + r.error + ' ',
        isAdmin() ? h('button', { type: 'button', class: 'btn sm', text: 'Đăng lại', onclick: function () { review(p, 'retry', k); } }) : null));
      else if (r && st === 'done' && r.error) errs.push(h('div', { class: 'plat-note', text: S.platforms[k] + ': ' + r.error }));
    });

    var when = p.scheduled ? 'Hẹn đăng: ' + fmt(p.scheduled) : 'Đăng ngay khi được duyệt';
    var meta = h('div', { class: 'meta' },
      h('span', { class: 'badge st-' + p.status, text: STATUS[p.status] || p.status }),
      h('span', { text: '🕒 ' + when }),
      h('span', { text: '✍ ' + p.authorName }),
      p.reviewerName && p.status !== 'pending' ? h('span', { text: (p.status === 'rejected' ? 'Trả lại bởi ' : 'Duyệt bởi ') + p.reviewerName }) : null);

    var acts = h('div', { class: 'actions' });
    var canEdit = isAdmin() ? ['draft', 'pending', 'rejected', 'approved'].indexOf(p.status) >= 0
      : mine && ['draft', 'pending', 'rejected'].indexOf(p.status) >= 0;
    if (isAdmin() && ['pending', 'draft', 'rejected'].indexOf(p.status) >= 0) {
      acts.appendChild(h('button', { type: 'button', class: 'btn primary sm', text: p.scheduled && p.scheduled > Date.now() / 1000 ? '✓ Duyệt & lên lịch' : '✓ Duyệt & đăng ngay', onclick: function () { review(p, 'approve'); } }));
    }
    if (isAdmin() && p.status === 'pending') acts.appendChild(h('button', { type: 'button', class: 'btn sm', text: 'Trả lại', onclick: function () { reject(p); } }));
    if (isAdmin() && p.status === 'approved') {
      acts.appendChild(h('button', { type: 'button', class: 'btn accent sm', text: 'Đăng ngay', onclick: function () { review(p, 'publish-now'); } }));
      acts.appendChild(h('button', { type: 'button', class: 'btn sm', text: 'Hủy duyệt', onclick: function () { review(p, 'unapprove'); } }));
    }
    if (canEdit) acts.appendChild(h('a', { class: 'btn sm', href: '#soan/' + p.id, text: 'Sửa' }));
    if (!isAdmin() && mine && p.status === 'draft') acts.appendChild(h('button', { type: 'button', class: 'btn primary sm', text: 'Gửi duyệt', onclick: function () { submitDraft(p); } }));
    if ((isAdmin() && p.status !== 'publishing') || (mine && ['draft', 'pending', 'rejected'].indexOf(p.status) >= 0)) {
      acts.appendChild(h('button', { type: 'button', class: 'btn danger sm', text: 'Xóa', onclick: function () { del(p); } }));
    }

    return h('article', { class: 'post' }, media, h('div', { class: 'body' },
      h('h3', { text: p.title || (p.caption ? p.caption.split('\n')[0].slice(0, 90) : '(Không tiêu đề)') }),
      meta, cap, more,
      p.status === 'rejected' && p.note ? h('div', { class: 'note', text: 'Lý do trả lại: ' + p.note }) : null,
      plats, errs, acts));
  }

  function review(p, action, platform) {
    var go = function () {
      api('post-review', { id: p.id, do: action, platform: platform }).then(function () {
        toast({ approve: 'Đã duyệt bài.', 'publish-now': 'Đã đưa bài vào đăng ngay (trong khoảng 1 phút).', unapprove: 'Đã hủy duyệt, bài về hàng chờ.', retry: 'Sẽ đăng lại trong khoảng 1 phút.' }[action] || 'Đã cập nhật.');
        route();
      }).catch(function (e) { toast(e.message, true); });
    };
    if (action === 'publish-now') confirmBox('Đăng bài này ngay lên ' + p.platforms.map(function (k) { return S.platforms[k]; }).join(', ') + '?').then(function (ok) { if (ok) go(); });
    else go();
  }
  function reject(p) {
    modal('Trả lại bài cho người soạn', [{ name: 'note', label: 'Lý do / yêu cầu sửa', type: 'textarea' }], 'Trả lại').then(function (v) {
      if (!v) return;
      api('post-review', { id: p.id, do: 'reject', note: v.note }).then(function () { toast('Đã trả lại bài.'); route(); }).catch(function (e) { toast(e.message, true); });
    });
  }
  function del(p) {
    confirmBox('Xóa hẳn bài này (cả video/ảnh đã tải lên)?').then(function (ok) {
      if (!ok) return;
      api('post-delete', { id: p.id }).then(function () { toast('Đã xóa bài.'); route(); }).catch(function (e) { toast(e.message, true); });
    });
  }
  function submitDraft(p) {
    api('post-save', { id: p.id, title: p.title, caption: p.caption, media: p.media, mediaName: p.mediaName, platforms: p.platforms, scheduled: p.scheduled, mode: 'submit' })
      .then(function () { toast('Đã gửi bài chờ duyệt.'); route(); }).catch(function (e) { toast(e.message, true); });
  }

  /* ---------- soạn bài ---------- */
  function viewCompose(id) {
    var main = shell('soan');
    var p = id ? S.posts.filter(function (x) { return x.id === id; })[0] : null;
    if (id && !p) { main.appendChild(h('p', { text: 'Không tìm thấy bài.' })); return; }
    var st = { media: p ? p.media : '', mediaType: p ? p.mediaType : '', mediaUrl: p ? p.mediaUrl : '', mediaName: p ? p.mediaName : '', uploading: false };

    var title = h('input', { type: 'text', maxlength: 100, placeholder: 'Tiêu đề video (dùng cho YouTube, Facebook)', value: p ? p.title : '' });
    var caption = h('textarea', { rows: 9, placeholder: 'Nội dung bài viết / mô tả video, hashtag…' });
    caption.value = p ? p.caption : '';
    var counter = h('div', { class: 'counter' });
    function count() {
      var n = caption.value.length;
      counter.textContent = n + ' ký tự · Instagram & TikTok tối đa 2.200';
      counter.className = 'counter' + (n > 2200 ? ' over' : '');
    }
    caption.addEventListener('input', count); count();

    // Tệp video / ảnh
    var fileInput = h('input', { type: 'file', accept: 'video/mp4,video/quicktime,image/jpeg', hidden: true });
    var mediaBox = h('div');
    function drawMedia(progress) {
      clear(mediaBox);
      if (st.uploading) {
        mediaBox.appendChild(h('div', null, h('div', { text: 'Đang tải lên ' + st.mediaName + '…' }),
          h('div', { class: 'progress' }, h('i', { style: 'width:' + (progress || 0) + '%' })),
          h('div', { class: 'hint', text: Math.round(progress || 0) + '% · đừng đóng trang khi đang tải' })));
        return;
      }
      if (st.media) {
        mediaBox.appendChild(h('div', { class: 'preview' }, st.mediaType === 'video'
          ? h('video', { src: st.mediaUrl, controls: true, preload: 'metadata', playsinline: true })
          : h('img', { src: st.mediaUrl, alt: '' })));
        mediaBox.appendChild(h('div', { class: 'row', style: 'margin-top:8px' },
          h('span', { class: 'hint', text: st.mediaName || '' }),
          h('button', { type: 'button', class: 'btn sm', text: 'Đổi tệp khác', onclick: function () { fileInput.click(); } }),
          h('button', { type: 'button', class: 'btn sm danger', text: 'Bỏ tệp', onclick: function () { st.media = ''; st.mediaType = ''; st.mediaUrl = ''; st.mediaName = ''; drawMedia(); syncPlatforms(); } })));
        return;
      }
      var drop = h('div', { class: 'drop', onclick: function () { fileInput.click(); } },
        h('div', { style: 'font-size:30px' }, '🎬'),
        h('strong', { text: 'Bấm để chọn video hoặc ảnh' }), h('br'),
        h('span', { class: 'hint', text: 'Hoặc kéo thả tệp vào đây · Video MP4/MOV (tối đa 2 GB), ảnh JPG' }));
      ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
      mediaBox.appendChild(drop);
    }
    fileInput.addEventListener('change', function () { if (fileInput.files[0]) upload(fileInput.files[0]); fileInput.value = ''; });

    function upload(file) {
      if (!/^(video\/(mp4|quicktime)|image\/jpeg)$/.test(file.type) && !/\.(mp4|mov|jpe?g)$/i.test(file.name)) return toast('Chỉ nhận video MP4/MOV hoặc ảnh JPG.', true);
      if (file.size > 2147483648) return toast('Tệp quá lớn (tối đa 2 GB).', true);
      var uid = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      var total = Math.max(1, Math.ceil(file.size / CHUNK));
      st.uploading = true; st.mediaName = file.name; drawMedia(0); setBusy(true);
      var i = 0;
      (function next() {
        var fd = new FormData();
        fd.append('uid', uid); fd.append('index', i); fd.append('total', total); fd.append('size', file.size);
        fd.append('chunk', file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK)), 'chunk');
        api('upload-chunk', fd).then(function (d) {
          i++;
          if (i < total) { drawMedia(i / total * 100); return next(); }
          st.uploading = false; st.media = d.file; st.mediaType = d.mediaType; st.mediaUrl = d.url;
          drawMedia(); syncPlatforms(); setBusy(false); toast('Đã tải lên ' + file.name + ' (' + size(file.size) + ').');
        }).catch(function (e) {
          st.uploading = false; st.mediaName = ''; drawMedia(); setBusy(false); toast(e.message, true);
        });
      })();
    }

    // Nền tảng
    var checks = h('div', { class: 'checks' });
    var boxes = {};
    var chosen = p ? p.platforms : Object.keys(S.platforms).filter(function (k) { return S.connected[k]; });
    Object.keys(S.platforms).forEach(function (k) {
      var cb = h('input', { type: 'checkbox', value: k, checked: chosen.indexOf(k) >= 0 });
      boxes[k] = cb;
      var conn = S.connected[k];
      checks.appendChild(h('label', null, cb, h('strong', { text: S.platforms[k] }),
        h('small', { class: conn ? '' : 'off', text: conn ? conn : 'chưa kết nối' })));
    });
    var platHint = h('p', { class: 'hint' });
    var autoOff = {};
    function setAllowed(k, ok) {
      var b = boxes[k];
      if (!ok) { if (b.checked) autoOff[k] = true; b.checked = false; b.disabled = true; return; }
      b.disabled = false;
      if (autoOff[k]) { b.checked = true; delete autoOff[k]; }
    }
    function syncPlatforms() {
      var t = st.mediaType;
      setAllowed('youtube', t === 'video'); setAllowed('tiktok', t === 'video'); setAllowed('instagram', !!t);
      platHint.textContent = !t ? 'YouTube, TikTok, Instagram cần có video (Instagram nhận cả ảnh).' : t === 'image' ? 'YouTube và TikTok chỉ nhận video.' : '';
    }

    // Thời gian
    var now = !p || !p.scheduled;
    var asap = h('input', { type: 'checkbox', checked: now });
    var when = h('input', { type: 'datetime-local', value: p && p.scheduled ? toLocalInput(p.scheduled) : toLocalInput(Math.ceil(Date.now() / 3600000 + 1) * 3600) });
    function syncWhen() { when.disabled = asap.checked; }
    asap.addEventListener('change', syncWhen); syncWhen();

    var err = h('p', { class: 'err' });
    var buttons = [];
    function btn(text, cls, mode) {
      var b = h('button', { type: 'button', class: 'btn ' + cls, text: text, onclick: function () { save(mode); } });
      buttons.push(b); return b;
    }
    function setBusy(b) { buttons.forEach(function (x) { x.disabled = b; }); }

    function save(mode) {
      err.textContent = '';
      if (st.uploading) return;
      var sched = null;
      if (!asap.checked) {
        if (!when.value) { err.textContent = 'Hãy chọn thời gian đăng.'; return; }
        sched = Math.floor(new Date(when.value).getTime() / 1000);
        if (mode !== 'draft' && sched < Date.now() / 1000 - 60) { err.textContent = 'Thời gian đăng đã qua, hãy chọn lại (hoặc tick "Đăng ngay khi được duyệt").'; return; }
      }
      var platforms = Object.keys(boxes).filter(function (k) { return boxes[k].checked; });
      if (mode !== 'draft' && !platforms.length) { err.textContent = 'Hãy chọn ít nhất một nền tảng.'; return; }
      setBusy(true);
      api('post-save', { id: p ? p.id : 0, title: title.value, caption: caption.value, media: st.media, mediaName: st.mediaName, platforms: platforms, scheduled: sched, mode: mode })
        .then(function (d) {
          toast({ draft: 'Đã lưu nháp.', submit: 'Đã gửi bài chờ quản trị duyệt.', approve: 'Đã duyệt, bài sẽ tự đăng đúng giờ.' }[mode]);
          location.hash = mode === 'draft' && !p ? '#soan/' + d.id : '#bai';
          if (mode === 'draft' && p) route();
        })
        .catch(function (e) { err.textContent = e.message; setBusy(false); });
    }

    var actions = [btn('Lưu nháp', '', 'draft')];
    if (isAdmin()) actions.push(btn('✓ Duyệt & lên lịch đăng', 'primary', 'approve'));
    else actions.push(btn('Gửi duyệt', 'primary', 'submit'));

    main.appendChild(h('h2', { text: p ? 'Sửa bài #' + p.id : 'Soạn bài mới' }));
    if (p && p.status === 'rejected' && p.note) main.appendChild(h('div', { class: 'banner bad', text: 'Quản trị đã trả lại: ' + p.note }));
    if (p && p.status === 'approved') main.appendChild(h('div', { class: 'banner warn', text: 'Bài này đã được duyệt. Lưu thay đổi vẫn giữ trạng thái đã duyệt.' }));
    main.appendChild(h('div', { class: 'compose' },
      h('div', null,
        h('div', { class: 'panel' }, h('h3', { text: '1. Video / ảnh' }), mediaBox, fileInput),
        h('div', { class: 'panel' }, h('h3', { text: '2. Nội dung' }),
          h('label', { class: 'f' }, h('span', { text: 'Tiêu đề' }), title),
          h('label', { class: 'f' }, h('span', { text: 'Nội dung / mô tả' }), caption, counter))),
      h('div', null,
        h('div', { class: 'panel' }, h('h3', { text: '3. Đăng lên' }), checks, platHint),
        h('div', { class: 'panel' }, h('h3', { text: '4. Thời gian đăng' }),
          h('label', { class: 'switch', style: 'margin-bottom:10px' }, asap, 'Đăng ngay khi được duyệt'),
          h('label', { class: 'f' }, h('span', { text: 'Hoặc hẹn giờ đăng' }), when)),
        h('div', { class: 'panel' }, err, h('div', { class: 'sticky-actions' }, actions),
          h('p', { class: 'hint', style: 'margin:10px 0 0', text: isAdmin() ? 'Bài đã duyệt sẽ tự động đăng đồng loạt vào đúng thời gian hẹn.' : 'Sau khi gửi duyệt, quản trị viên xem và duyệt thì bài mới được đăng.' })))));
    drawMedia(); syncPlatforms();
  }

  /* ---------- kết nối tài khoản ---------- */
  function viewSettings() {
    var main = shell('ket-noi');
    main.appendChild(h('h2', { text: 'Kết nối tài khoản mạng xã hội' }));
    api('settings').then(function (c) {
      var copy = function (v) {
        var inp = h('input', { type: 'text', value: v, readonly: true });
        return h('div', { class: 'copy' }, inp, h('button', { type: 'button', class: 'btn sm', text: 'Chép', onclick: function () { inp.select(); navigator.clipboard && navigator.clipboard.writeText(v); toast('Đã chép.'); } }));
      };
      var field = function (label, val, ph) {
        var i = h('input', { type: 'text', value: val || '', placeholder: ph || '', autocomplete: 'off' });
        return [h('label', { class: 'f' }, h('span', { text: label }), i), i];
      };
      var status = function (on, text) { return h('div', { class: 'status' + (on ? ' on' : '') }, h('span', { class: 'dot' }), text); };
      var saveThen = function (data, then) {
        api('settings-save', data).then(function () { if (then) then(); else { toast('Đã lưu.'); refreshMe().then(viewSettings); } }).catch(function (e) { toast(e.message, true); });
      };

      // Chung
      var dry = h('input', { type: 'checkbox', checked: c.dryRun, onchange: function () { saveThen({ dryRun: dry.checked }); } });
      main.appendChild(h('div', { class: 'panel' },
        h('h3', { text: 'Thông tin chung' }),
        h('label', { class: 'f' }, h('span', { text: 'Địa chỉ chuyển hướng (Redirect URI) – khai báo giống nhau ở Meta, Google và TikTok' }), copy(c.redirectUri)),
        h('label', { class: 'switch' }, dry, 'Chế độ chạy thử (giả lập đăng, không đăng thật)'),
        h('p', { class: 'hint', text: 'Bật khi muốn tập quy trình soạn – duyệt – đăng mà chưa kết nối tài khoản thật.' })));

      var grid = h('div', { class: 'conn' });
      main.appendChild(grid);

      // Facebook + Instagram
      var fbId = field('App ID', c.fbAppId), fbSec = field('App Secret', c.fbAppSecret, 'Dán App Secret');
      var fbBox = h('div', { class: 'panel' }, h('h3', { text: 'Facebook Fanpage & Instagram' }),
        status(!!c.fbPage, c.fbPage ? 'Fanpage: ' + c.fbPage.name : 'Chưa kết nối Fanpage'),
        status(!!c.igAccount, c.igAccount ? 'Instagram: @' + c.igAccount.username : 'Chưa có Instagram (cần tài khoản Business/Creator liên kết với Fanpage)'),
        fbId[0], fbSec[0]);
      if (c.fbPages && c.fbPages.length > 1) {
        var sel = h('select', null, c.fbPages.map(function (pg) {
          return h('option', { value: pg.id, selected: c.fbPage && c.fbPage.id === pg.id, text: pg.name + (pg.ig ? ' (IG @' + pg.ig + ')' : '') });
        }));
        if (!c.fbPage) sel.insertBefore(h('option', { value: '', text: '— Chọn Fanpage —', selected: true }), sel.firstChild);
        fbBox.appendChild(h('label', { class: 'f' }, h('span', { text: 'Fanpage dùng để đăng' }), sel));
        sel.addEventListener('change', function () { if (sel.value) saveThen({ fbPage: sel.value }); });
      }
      fbBox.appendChild(h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', text: 'Lưu', onclick: function () { saveThen({ fbAppId: fbId[1].value, fbAppSecret: fbSec[1].value }); } }),
        h('button', { type: 'button', class: 'btn primary', text: c.fbPage ? 'Kết nối lại' : 'Kết nối Facebook', onclick: function () { saveThen({ fbAppId: fbId[1].value, fbAppSecret: fbSec[1].value }, function () { location.href = 'oauth.php?start=facebook'; }); } }),
        c.fbPage ? h('button', { type: 'button', class: 'btn danger', text: 'Ngắt kết nối', onclick: function () { saveThen({ disconnect: 'facebook' }); } }) : null));
      grid.appendChild(fbBox);

      // YouTube
      var gId = field('Client ID', c.googleClientId), gSec = field('Client secret', c.googleClientSecret, 'Dán Client secret');
      var ytPriv = h('select', null, [['public', 'Công khai'], ['unlisted', 'Không công khai (có link mới xem được)'], ['private', 'Riêng tư']].map(function (o) {
        return h('option', { value: o[0], selected: c.ytPrivacy === o[0], text: o[1] });
      }));
      grid.appendChild(h('div', { class: 'panel' }, h('h3', { text: 'YouTube' }),
        status(!!c.yt, c.yt ? 'Kênh: ' + c.yt.channel : 'Chưa kết nối kênh'),
        gId[0], gSec[0], h('label', { class: 'f' }, h('span', { text: 'Chế độ hiển thị video' }), ytPriv),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn', text: 'Lưu', onclick: function () { saveThen({ googleClientId: gId[1].value, googleClientSecret: gSec[1].value, ytPrivacy: ytPriv.value }); } }),
          h('button', { type: 'button', class: 'btn primary', text: c.yt ? 'Kết nối lại' : 'Kết nối YouTube', onclick: function () { saveThen({ googleClientId: gId[1].value, googleClientSecret: gSec[1].value, ytPrivacy: ytPriv.value }, function () { location.href = 'oauth.php?start=youtube'; }); } }),
          c.yt ? h('button', { type: 'button', class: 'btn danger', text: 'Ngắt kết nối', onclick: function () { saveThen({ disconnect: 'youtube' }); } }) : null)));

      // TikTok
      var tId = field('Client key', c.tiktokClientKey), tSec = field('Client secret', c.tiktokClientSecret, 'Dán Client secret');
      var ttPriv = h('select', null, [['PUBLIC_TO_EVERYONE', 'Công khai'], ['FOLLOWER_OF_CREATOR', 'Người theo dõi'], ['MUTUAL_FOLLOW_FRIENDS', 'Bạn bè'], ['SELF_ONLY', 'Chỉ mình tôi']].map(function (o) {
        return h('option', { value: o[0], selected: c.ttPrivacy === o[0], text: o[1] });
      }));
      grid.appendChild(h('div', { class: 'panel' }, h('h3', { text: 'TikTok' }),
        status(!!c.tt, c.tt ? 'Tài khoản: ' + c.tt.name : 'Chưa kết nối tài khoản'),
        tId[0], tSec[0], h('label', { class: 'f' }, h('span', { text: 'Ai được xem video' }), ttPriv),
        h('p', { class: 'hint', text: 'Khi ứng dụng TikTok chưa được TikTok duyệt, video chỉ đăng được ở chế độ "Chỉ mình tôi".' }),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn', text: 'Lưu', onclick: function () { saveThen({ tiktokClientKey: tId[1].value, tiktokClientSecret: tSec[1].value, ttPrivacy: ttPriv.value }); } }),
          h('button', { type: 'button', class: 'btn primary', text: c.tt ? 'Kết nối lại' : 'Kết nối TikTok', onclick: function () { saveThen({ tiktokClientKey: tId[1].value, tiktokClientSecret: tSec[1].value, ttPrivacy: ttPriv.value }, function () { location.href = 'oauth.php?start=tiktok'; }); } }),
          c.tt ? h('button', { type: 'button', class: 'btn danger', text: 'Ngắt kết nối', onclick: function () { saveThen({ disconnect: 'tiktok' }); } }) : null)));
    }).catch(function (e) { toast(e.message, true); });
  }
  function refreshMe() {
    return api('me').then(function (d) { if (d.user) { S.connected = d.connected; S.dryRun = d.dryRun; } });
  }

  /* ---------- tài khoản nhân viên ---------- */
  function viewUsers() {
    var main = shell('nhan-vien');
    main.appendChild(h('h2', { text: 'Tài khoản nhân viên' }));
    main.appendChild(h('p', { class: 'hint', text: 'Nhân viên được soạn bài và gửi duyệt. Quản trị viên được duyệt bài, kết nối tài khoản mạng xã hội và quản lý nhân viên. Các tài khoản này tách riêng với trang quản trị website.' }));
    var u = h('input', { type: 'text', placeholder: 'vd: lan.nguyen', autocomplete: 'off' });
    var n = h('input', { type: 'text', placeholder: 'Họ tên', autocomplete: 'off' });
    var pw = h('input', { type: 'text', placeholder: 'Ít nhất 8 ký tự', autocomplete: 'off' });
    var role = h('select', null, h('option', { value: 'staff', text: 'Nhân viên' }), h('option', { value: 'admin', text: 'Quản trị' }));
    var err = h('p', { class: 'err' });
    var form = h('form', { class: 'panel' }, h('h3', { text: 'Thêm tài khoản' }),
      h('div', { class: 'conn', style: 'grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px' },
        h('label', { class: 'f' }, h('span', { text: 'Tên đăng nhập' }), u),
        h('label', { class: 'f' }, h('span', { text: 'Họ tên' }), n),
        h('label', { class: 'f' }, h('span', { text: 'Mật khẩu ban đầu' }), pw),
        h('label', { class: 'f' }, h('span', { text: 'Vai trò' }), role)),
      err, h('button', { type: 'submit', class: 'btn primary', text: 'Thêm tài khoản' }));
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      api('user-save', { username: u.value, name: n.value, password: pw.value, role: role.value, active: 1 })
        .then(function () { toast('Đã thêm tài khoản.'); viewUsers(); }).catch(function (x) { err.textContent = x.message; });
    });
    main.appendChild(form);
    var wrap = h('div', { class: 'table-wrap' });
    main.appendChild(wrap);
    api('users').then(function (d) {
      wrap.appendChild(h('table', null,
        h('thead', null, h('tr', null, ['Tên đăng nhập', 'Họ tên', 'Vai trò', 'Số bài', 'Trạng thái', ''].map(function (t) { return h('th', { text: t }); }))),
        h('tbody', null, d.users.map(function (x) {
          var save = function (patch, msg) {
            var body = { id: x.id, name: x.name, role: x.role, active: x.active };
            Object.keys(patch).forEach(function (k) { body[k] = patch[k]; });
            api('user-save', body).then(function () { toast(msg); viewUsers(); }).catch(function (e) { toast(e.message, true); });
          };
          var self = x.id === S.me.id;
          return h('tr', null,
            h('td', { text: x.username }), h('td', { text: x.name }),
            h('td', { text: x.role === 'admin' ? 'Quản trị' : 'Nhân viên' }), h('td', { text: x.posts }),
            h('td', null, h('span', { class: 'badge ' + (x.active ? 'st-done' : 'st-failed'), text: x.active ? 'Đang dùng' : 'Đã khóa' })),
            h('td', null, h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn sm', text: 'Đổi tên', onclick: function () {
                modal('Đổi họ tên', [{ name: 'name', label: 'Họ tên', value: x.name }], 'Lưu').then(function (v) { if (v) save({ name: v.name }, 'Đã đổi tên.'); });
              } }),
              h('button', { type: 'button', class: 'btn sm', text: 'Đặt lại mật khẩu', onclick: function () {
                modal('Đặt mật khẩu mới cho ' + x.username, [{ name: 'password', label: 'Mật khẩu mới (ít nhất 8 ký tự)', type: 'text' }], 'Lưu').then(function (v) { if (v) save({ password: v.password }, 'Đã đặt lại mật khẩu.'); });
              } }),
              self ? null : h('button', { type: 'button', class: 'btn sm', text: x.role === 'admin' ? 'Chuyển thành nhân viên' : 'Cấp quyền quản trị', onclick: function () { save({ role: x.role === 'admin' ? 'staff' : 'admin' }, 'Đã đổi vai trò.'); } }),
              self ? null : h('button', { type: 'button', class: 'btn sm ' + (x.active ? 'danger' : ''), text: x.active ? 'Khóa' : 'Mở khóa', onclick: function () { save({ active: x.active ? 0 : 1 }, x.active ? 'Đã khóa tài khoản.' : 'Đã mở khóa.'); } }))));
        }))));
    }).catch(function (e) { toast(e.message, true); });
  }

  /* ---------- nhật ký ---------- */
  function viewLog() {
    var main = shell('nhat-ky');
    main.appendChild(h('h2', { text: 'Nhật ký hoạt động' }));
    var LABEL = { 'dang-nhap': 'Đăng nhập', 'luu-bai': 'Lưu bài', approve: 'Duyệt bài', 'publish-now': 'Đăng ngay', reject: 'Trả lại bài', unapprove: 'Hủy duyệt', retry: 'Đăng lại', 'xoa-bai': 'Xóa bài', 'tai-khoan': 'Sửa tài khoản', 'cai-dat': 'Sửa kết nối', 'ket-noi': 'Kết nối MXH', 'bat-dau-dang': 'Bắt đầu đăng', 'da-dang': 'Đã đăng', 'loi-dang': 'Lỗi đăng', 'doi-mat-khau': 'Đổi mật khẩu', 'tao-quan-tri': 'Tạo quản trị' };
    api('log').then(function (d) {
      main.appendChild(h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Thời gian', 'Người', 'Việc', 'Chi tiết'].map(function (t) { return h('th', { text: t }); }))),
        h('tbody', null, d.log.map(function (r) {
          return h('tr', null, h('td', { text: fmt(+r.ts) }), h('td', { text: r.who }), h('td', { text: LABEL[r.action] || r.action }), h('td', { text: r.detail }));
        })))));
    }).catch(function (e) { toast(e.message, true); });
  }

  boot();
})();
