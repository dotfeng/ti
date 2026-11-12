/* 列表页筛选 / 排序 / 客户端分页。
   静态分页继续作为默认形态（无 JS、爬虫、分享旧链接都正常）；
   用户一旦动筛选条件，就切到客户端模式，用 /data/docs-index.json 做全量过滤。 */
(function () {
  'use strict';

  var box = document.querySelector('[data-filters]');
  if (!box) return;
  var R = window.PaperRows;
  if (!R) return;

  var staticWrap = document.querySelector('[data-static]');
  var liveWrap = document.querySelector('[data-live]');
  if (!staticWrap || !liveWrap) return;

  var liveRows = liveWrap.querySelector('[data-live-rows]');
  var livePager = liveWrap.querySelector('[data-live-pager]');
  var liveStat = liveWrap.querySelector('[data-live-stat]');
  var yearSel = box.querySelector('[data-year]');
  var sortSel = box.querySelector('[data-sort]');
  var kwInp = box.querySelector('[data-kw]');
  var typeBox = box.querySelector('[data-type-group]');
  var resetBtn = box.querySelector('[data-reset]');

  var CAT = (box.getAttribute('data-cat') || '').trim();
  var BASE = box.getAttribute('data-base') || location.pathname;
  var IDX = box.getAttribute('data-index');
  var PER = 20;

  var pool = null;
  var pending = [];
  var loading = false;
  var liveOn = false;
  var pageOffset = 0;

  var DEF = { q: '', type: 'all', year: '', sort: 'year-desc', page: 1 };
  var state = { q: '', type: 'all', year: '', sort: 'year-desc', page: 1 };

  function inCat(d) {
    if (!CAT) return true;
    var segs = CAT.split('/');
    if (!d.c || d.c.length < segs.length) return false;
    for (var i = 0; i < segs.length; i++) if (d.c[i] !== segs[i]) return false;
    return true;
  }

  function cmpYear(a, b) { return String(b.s).localeCompare(String(a.s)); }
  function cmpTitle(a, b) { return String(a.t).localeCompare(String(b.t), 'zh'); }

  function sortList(list) {
    var arr = list.slice();
    if (state.sort === 'year-asc') {
      arr.sort(function (a, b) { return String(a.s).localeCompare(String(b.s)) || cmpTitle(a, b); });
    } else if (state.sort === 'q-desc') {
      arr.sort(function (a, b) { return (b.q || 0) - (a.q || 0) || cmpYear(a, b); });
    } else if (state.sort === 'title') {
      arr.sort(cmpTitle);
    } else {
      arr.sort(function (a, b) { return cmpYear(a, b) || cmpTitle(a, b); });
    }
    return arr;
  }

  function filtered() {
    var list = pool;
    if (state.type === 'answer') list = list.filter(function (d) { return d.a; });
    else if (state.type === 'only') list = list.filter(function (d) { return !d.a; });
    if (state.year) list = list.filter(function (d) { return String(d.y) === state.year; });

    if (state.q) {
      list = R.query(list, state.q);   // 有关键词时按相关度排，除非用户另选了顺序
      if (state.sort !== 'year-desc') list = sortList(list);
      return list;
    }
    return sortList(list);
  }

  function syncType() {
    Array.prototype.forEach.call(typeBox.querySelectorAll('.fchip'), function (b) {
      var on = b.getAttribute('data-type') === state.type;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function syncUrl() {
    var ps = new URLSearchParams();
    if (state.q) ps.set('q', state.q);
    if (state.type !== DEF.type) ps.set('ty', state.type);
    if (state.year) ps.set('yr', state.year);
    if (state.sort !== DEF.sort) ps.set('so', state.sort);
    if (state.page > 1) ps.set('p', String(state.page));
    var qs = ps.toString();
    try { history.replaceState(null, '', BASE + (qs ? '?' + qs : '')); } catch (e) { /* noop */ }
  }

  function renderPager(pages) {
    if (pages <= 1) { livePager.innerHTML = ''; return; }
    var start = Math.max(1, state.page - 2);
    var end = Math.min(pages, start + 4);
    start = Math.max(1, end - 4);
    var h = '<nav class="pager" aria-label="分页">' +
      '<button type="button" class="pg"' + (state.page === 1 ? ' disabled' : ' data-go="' + (state.page - 1) + '"') + '>上一页</button>';
    for (var n = start; n <= end; n++) {
      h += n === state.page
        ? '<span class="pg cur">' + n + '</span>'
        : '<button type="button" class="pg" data-go="' + n + '">' + n + '</button>';
    }
    h += '<button type="button" class="pg"' + (state.page === pages ? ' disabled' : ' data-go="' + (state.page + 1) + '"') + '>下一页</button>' +
      '</nav>';
    livePager.innerHTML = h;
  }

  function render() {
    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / PER));
    if (state.page > pages) state.page = pages;
    pageOffset = (state.page - 1) * PER;
    var slice = list.slice(pageOffset, state.page * PER);

    if (!slice.length) {
      liveRows.innerHTML = '';
      liveStat.className = 'live-stat is-empty';
      liveStat.innerHTML = '<span class="ls-none">没有符合条件的结果</span>' +
        '<button type="button" class="linkbtn" data-reset>清除筛选条件</button>';
    } else {
      liveStat.className = 'live-stat';
      R.render(liveRows, slice, state.q ? R.marker(R.terms(state.q)) : null, pageOffset);
      liveStat.innerHTML = '筛选后共 <b>' + list.length + '</b> 套' +
        (pages > 1 ? '，第 <b>' + state.page + '</b>/' + pages + ' 页' : '');
    }
    renderPager(pages);
    if (pageOffset > 0) {
      var top = box.getBoundingClientRect().top + window.pageYOffset - 70;
      window.scrollTo({ top: top, behavior: 'smooth' });
    }
    syncUrl();
  }

  function fillYears() {
    var seen = {};
    pool.forEach(function (d) { if (d.y) seen[d.y] = 1; });
    var arr = Object.keys(seen).map(Number).sort(function (a, b) { return b - a; });
    var h = '<option value="">全部年份</option>';
    arr.forEach(function (y) { h += '<option value="' + y + '">' + y + ' 年</option>'; });
    yearSel.innerHTML = h;
    yearSel.value = state.year || '';
    // URL 里的年份不在当前分类里时，退回「全部年份」，避免筛出空结果
    if (yearSel.value !== (state.year || '')) state.year = '';
  }

  function enterLive() {
    if (!liveOn) {
      liveOn = true;
      staticWrap.hidden = true;
      liveWrap.hidden = false;
    }
    resetBtn.hidden = false;
  }

  function ensure(cb) {
    enterLive();
    load(cb);
  }

  /* 取索引并缓存；cb 传 null 表示静默预取（只填年份下拉，不切换视图） */
  function load(cb) {
    if (pool) { if (cb) cb(); return; }
    if (cb) pending.push(cb);
    if (loading) return;
    loading = true;
    if (cb) liveStat.textContent = '正在加载索引…';
    fetch(IDX).then(function (r) { return r.json(); }).then(function (d) {
      pool = (d.docs || []).filter(inCat);
      fillYears();
      loading = false;
      var q = pending;
      pending = [];
      q.forEach(function (fn) { fn(); });
    }).catch(function () {
      loading = false;
      pending = [];
      if (cb) liveStat.textContent = '索引加载失败，请刷新页面重试。';
    });
  }

  function reset() {
    state = { q: DEF.q, type: DEF.type, year: DEF.year, sort: DEF.sort, page: DEF.page };
    kwInp.value = '';
    yearSel.value = '';
    sortSel.value = DEF.sort;
    syncType();
    liveOn = false;
    liveWrap.hidden = true;
    staticWrap.hidden = false;
    resetBtn.hidden = true;
    liveRows.innerHTML = '';
    livePager.innerHTML = '';
    liveStat.className = 'live-stat';
    liveStat.textContent = '';
    try { history.replaceState(null, '', BASE); } catch (e) { /* noop */ }
  }

  function go(n) {
    ensure(function () {
      state.page = n;
      render();
    });
  }

  function apply() {
    ensure(function () {
      state.page = 1;
      render();
    });
  }

  /* ---------- 事件 ---------- */

  var timer = null;
  kwInp.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.q = kwInp.value.trim();
      apply();
    }, 180);
  });
  kwInp.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      kwInp.value = '';
      state.q = '';
      apply();
    }
  });

  yearSel.addEventListener('change', function () {
    state.year = yearSel.value;
    apply();
  });

  sortSel.addEventListener('change', function () {
    state.sort = sortSel.value;
    apply();
  });

  typeBox.addEventListener('click', function (e) {
    var b = e.target.closest('.fchip');
    if (!b) return;
    state.type = b.getAttribute('data-type');
    syncType();
    apply();
  });

  box.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(parseInt(g.getAttribute('data-go'), 10) || 1); }
  });

  /* 「清除筛选条件」在结果区（不在筛选条里），事件挂到文档上 */
  document.addEventListener('click', function (e) {
    var r = e.target.closest ? e.target.closest('[data-reset]') : null;
    if (!r || r.disabled) return;
    e.preventDefault();
    reset();
  });

  livePager.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (!g) return;
    go(parseInt(g.getAttribute('data-go'), 10) || 1);
  });

  /* ---------- 首屏：默认「全部」选中，并静默预取年份选项 ---------- */
  syncType();

  (function preload() {
    // 年份下拉的选项来自索引，先静默取一次，避免「年份不可选」
    var idle = window.requestIdleCallback
      ? function (fn) { window.requestIdleCallback(fn, { timeout: 2000 }); }
      : function (fn) { setTimeout(fn, 900); };
    idle(function () { load(null); });

    // 鼠标/键盘一靠近筛选条就立刻取，比 idle 更快
    var tools = box.querySelector('.frow-tools');
    if (!tools) return;
    var evts = ['pointerenter', 'focusin', 'touchstart'];
    function once() {
      load(null);
      evts.forEach(function (t) { tools.removeEventListener(t, once); });
    }
    evts.forEach(function (t) { tools.addEventListener(t, once); });
  })();

  /* ---------- 带参数进入时直接激活客户端模式 ---------- */
  (function init() {
    var ps = new URLSearchParams(location.search);
    var q = ps.get('q') || '';
    var ty = ps.get('ty') || '';
    var yr = ps.get('yr') || '';
    var so = ps.get('so') || '';
    var pg = parseInt(ps.get('p'), 10) || 1;
    if (!q && !ty && !yr && !so && pg === 1) return;

    state.q = q;
    state.type = (ty === 'answer' || ty === 'only') ? ty : DEF.type;
    state.year = yr;
    state.sort = so || DEF.sort;
    state.page = pg;
    kwInp.value = q;
    sortSel.value = state.sort;
    syncType();
    ensure(function () { render(); });
  })();
})();
