/* 文档列表行渲染：搜索页与分类页的客户端筛选共用。
   依赖 docs-index.json 的单条记录（字段含义见 scripts/search-index.js）。 */
(function (root) {
  'use strict';

  var CN = {};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stateOf(d) {
    if (!d.a) return '仅试题';
    return d.k === 'answer' ? '试题+答案' : '试题+解析';
  }

  function link(d, inner) {
    return '<a class="ttl" href="' + d.u + '">' + inner + '</a>';
  }

  // hilite：可选，接收已转义标题，返回带 <mark> 的字符串
  function row(d, idx, hilite) {
    var t = esc(d.t);
    if (hilite) t = hilite(t);
    return '<li class="row">' +
      '<span class="idx">' + idx + '</span>' +
      link(d, t) +
      '<span class="cat"><i class="dot c-' + esc(d.c[0]) + '"></i>' + esc(d.n[0] || '') + '</span>' +
      '<span class="yr">' + (d.y || '—') + '</span>' +
      '<span class="qn">' + (d.q ? d.q + ' 题' : '—') + '</span>' +
      '<span class="st">' + stateOf(d) + '</span>' +
      '</li>';
  }

  function head() {
    return '<li class="row row-hd"><span class="idx">#</span><span class="ttl">文档名称</span>' +
      '<span class="cat">分类</span><span class="yr">年份</span><span class="qn">题量</span>' +
      '<span class="st">内容</span></li>';
  }

  function render(ul, items, hilite, offset) {
    if (!items.length) { ul.innerHTML = ''; return; }
    var base = offset || 0;
    var html = head();
    for (var i = 0; i < items.length; i++) html += row(items[i], base + i + 1, hilite);
    ul.innerHTML = html;
  }

  // 在已转义文本上做高亮：terms 也要先转义，保证下标一致
  function marker(terms) {
    if (!terms || !terms.length) return null;
    var list = terms.map(esc).filter(Boolean);
    if (!list.length) return null;
    // 长的先匹配，避免「AMC」抢走「AMC8」
    list.sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp('(' + list.map(function (t) {
      return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|') + ')', 'gi');
    return function (html) { return html.replace(re, '<mark>$1</mark>'); };
  }

  /* ---------- 检索：归一化 + 分词 + 打分 ---------- */

  var CN_DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var CN_RUN = /[零〇一二三四五六七八九十两]+/g;

  function cnRun(run) {
    if (run.indexOf('十') >= 0) {
      var i = run.indexOf('十');
      var hi = i === 0 ? 1 : CN_DIGIT[run.charAt(i - 1)];
      var lo = i === run.length - 1 ? 0 : CN_DIGIT[run.charAt(i + 1)];
      if (hi == null || lo == null) return run;
      return String(hi * 10 + lo);
    }
    var out = '';
    for (var k = 0; k < run.length; k++) {
      var d = CN_DIGIT[run.charAt(k)];
      if (d == null) return run;
      out += d;
    }
    return out;
  }

  // 全角转半角、小写、中文数字转阿拉伯数字（「第三十二届」→「第32届」）
  function normalize(s) {
    s = String(s == null ? '' : s).replace(/[\uFF01-\uFF5E]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
    s = s.toLowerCase();
    s = s.replace(CN_RUN, cnRun);
    return s;
  }

  function terms(raw) {
    return normalize(raw).split(/[\s,，、;；]+/).filter(function (t) { return t.length > 0; });
  }

  function textOf(d) {
    if (!d._x) d._x = normalize(d.t + ' ' + (d.n || []).join(' ') + ' ' + (d.y || '') + ' ' + (d.x || ''));
    return d._x;
  }

  // 纯数字词要按「完整数字」匹配：否则搜「AMC 8」会把 2018 / 2008 的卷子也算进来
  var DIGIT_RE = {};
  function hitTerm(hay, t) {
    if (/^\d+$/.test(t)) {
      var re = DIGIT_RE[t] || (DIGIT_RE[t] = new RegExp('(^|[^0-9])' + t + '([^0-9]|$)'));
      return re.test(hay);
    }
    return hay.indexOf(t) >= 0;
  }

  function match(d, ts) {
    var hay = textOf(d);
    for (var i = 0; i < ts.length; i++) {
      if (!hitTerm(hay, ts[i])) return false;
    }
    return true;
  }

  function score(d, ts) {
    var title = normalize(d.t), cats = normalize((d.n || []).join(' ')), n = 0;
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i];
      if (title.indexOf(t) === 0) n += 4;
      else if (title.indexOf(t) >= 0) n += 3;
      if (cats.indexOf(t) >= 0) n += 1;
      if (String(d.y) === t) n += 2;
      if (String(d.q) === t) n += 1;
    }
    return n;
  }

  // 搜索：按相关度排序；无关键词时原样返回（列表页已按年份排好）
  function query(docs, raw) {
    var ts = terms(raw);
    if (!ts.length) return docs.slice();
    var hit = docs.filter(function (d) { return match(d, ts); });
    hit.sort(function (a, b) {
      return score(b, ts) - score(a, ts) || String(b.s).localeCompare(String(a.s));
    });
    return hit;
  }

  root.PaperRows = {
    esc: esc, row: row, head: head, render: render, marker: marker, stateOf: stateOf,
    normalize: normalize, terms: terms, match: match, query: query
  };
})(window);
