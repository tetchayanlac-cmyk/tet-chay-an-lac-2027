(function () {
  // Mobile nav
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('main-nav');
  toggle.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
  nav.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Countdown to opening day (09/01/2027, 08:00 Hanoi time)
  var target = new Date('2027-01-09T08:00:00+07:00').getTime();
  var end = new Date('2027-01-13T23:59:59+07:00').getTime();
  var cd = document.getElementById('countdown');
  var cells = {};
  cd.querySelectorAll('[data-cd]').forEach(function (el) { cells[el.dataset.cd] = el; });
  function pad(n) { return String(n).padStart(2, '0'); }
  function tick() {
    var now = Date.now();
    var diff = target - now;
    if (diff <= 0) {
      cd.classList.add('done');
      cd.textContent = now < end ? 'Lễ hội đang diễn ra – hẹn gặp bạn tại Công viên Thống Nhất!' : 'Cảm ơn bạn đã đồng hành cùng Tết Chay An Lạc 2027!';
      return;
    }
    var s = Math.floor(diff / 1000);
    cells.d.textContent = Math.floor(s / 86400);
    cells.h.textContent = pad(Math.floor(s % 86400 / 3600));
    cells.m.textContent = pad(Math.floor(s % 3600 / 60));
    cells.s.textContent = pad(s % 60);
    setTimeout(tick, 1000);
  }
  tick();

  // Schedule tabs
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function selectTab(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { selectTab(tab); });
    tab.addEventListener('keydown', function (e) {
      var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
      if (j === null) return;
      var next = tabs[(j + tabs.length) % tabs.length];
      selectTab(next); next.focus();
    });
  });
  // During the festival, open today's tab automatically
  var day = Math.floor((Date.now() - new Date('2027-01-09T00:00:00+07:00').getTime()) / 86400000);
  if (day >= 0 && day < tabs.length) selectTab(tabs[day]);

  // Zone map <-> zone cards
  var zoneBtns = document.querySelectorAll('.z');
  var zoneCards = document.querySelectorAll('.zone-card');
  function selectZone(id, scroll) {
    zoneBtns.forEach(function (b) { b.classList.toggle('active', b.dataset.zone === id); });
    zoneCards.forEach(function (c) {
      var on = c.dataset.zone === id;
      c.classList.toggle('active', on);
      if (on && scroll && window.innerWidth <= 900) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  zoneBtns.forEach(function (b) {
    b.addEventListener('click', function () { selectZone(b.dataset.zone, true); });
  });
  zoneCards.forEach(function (c) {
    c.addEventListener('mouseenter', function () { selectZone(c.dataset.zone, false); });
  });

  // CTA buttons preselect the registration interest
  var interest = document.getElementById('interest');
  document.querySelectorAll('[data-interest]').forEach(function (a) {
    a.addEventListener('click', function () { interest.value = a.dataset.interest; });
  });

  // Registration form – sent to api.php, listed in admin.html
  var form = document.getElementById('reg-form');
  var msg = form.querySelector('.form-msg');
  var submitBtn = form.querySelector('[type="submit"]');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var bad = [];
    form.querySelectorAll('input:not([name="website"])').forEach(function (inp) {
      var invalid = !inp.checkValidity();
      inp.classList.toggle('invalid', invalid);
      if (invalid) bad.push(inp);
    });
    if (bad.length) {
      msg.className = 'form-msg err';
      msg.textContent = 'Vui lòng kiểm tra lại họ tên và số điện thoại.';
      bad[0].focus();
      return;
    }
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name) data[el.name] = el.value; });
    submitBtn.disabled = true;
    msg.className = 'form-msg';
    msg.textContent = 'Đang gửi…';
    fetch('api.php?action=register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (res) {
          if (res === null) throw new Error('Trang này đang ở chế độ xem, chưa nhận đăng ký trực tuyến');
          if (!r.ok || res.ok !== true) throw new Error(res.error || 'Gửi chưa thành công');
        });
      })
      .then(function () {
        msg.className = 'form-msg ok';
        msg.textContent = 'Cảm ơn bạn! Ban Tổ chức sẽ liên hệ lại trong thời gian sớm nhất.';
        form.reset();
      })
      .catch(function (err) {
        msg.className = 'form-msg err';
        msg.textContent = (err.message === 'Failed to fetch' ? 'Không kết nối được máy chủ' : err.message) + '. Vui lòng thử lại hoặc gọi hotline Ban Tổ chức.';
      })
      .then(function () { submitBtn.disabled = false; });
  });

  // Highlight current nav item and reveal sections on scroll
  if ('IntersectionObserver' in window) {
    var links = {};
    nav.querySelectorAll('a[href^="#"]:not(.btn)').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && links[en.target.id]) {
          Object.keys(links).forEach(function (k) { links[k].classList.remove('active'); });
          links[en.target.id].classList.add('active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach(function (s) { spy.observe(s); });

    var reveal = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); reveal.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.section-head, .value, .card, .tier, .info, .zone-card, .pre-event, .day, .scoring, .topic-sponsors > div').forEach(function (el) {
      el.classList.add('reveal');
      reveal.observe(el);
    });
  }
})();
