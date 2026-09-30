/* 页面三：轮动明细（低价策略每次轮动的个券与收益） */
"use strict";

var RotApp = {
  DATA: null,          // /api/rotations 或快照 backtest 结果
  SNAP: null,          // 快照对象（非 null 表示分享快照模式）
  view: "group",       // group | table
  orderDesc: true,     // 分组视图日期排序
  sortKey: "trade_date", sortDesc: true,  // 表格视图排序

  init: function () {
    this.bindEvents();
    this.load();
  },

  bindEvents: function () {
    var self = this;
    // 快捷区间（以最新轮动日为基准回推）
    var btns = document.querySelectorAll(".rot-controls .preset[data-days]");
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(btns, function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        self.applyPreset(b.getAttribute("data-days"));
        self.applyFilter();
      });
    });
    document.getElementById("rotStart").addEventListener("change", function () {
      self.clearPresetActive(); self.applyFilter();
    });
    document.getElementById("rotEnd").addEventListener("change", function () {
      self.clearPresetActive(); self.applyFilter();
    });
    var deb = null;
    document.getElementById("rotSearch").addEventListener("input", function () {
      clearTimeout(deb);
      deb = setTimeout(function () { self.applyFilter(); }, 200);
    });
    // 视图切换
    document.getElementById("viewGroupBtn").addEventListener("click", function () { self.setView("group"); });
    document.getElementById("viewTableBtn").addEventListener("click", function () { self.setView("table"); });
    document.getElementById("orderBtn").addEventListener("click", function () {
      self.orderDesc = !self.orderDesc;
      this.textContent = self.orderDesc ? "日期倒序" : "日期正序";
      self.renderGroups();
    });
    // 分享
    document.getElementById("shareBtn").addEventListener("click", function () { self.share(); });
  },

  clearPresetActive: function () {
    var btns = document.querySelectorAll(".rot-controls .preset[data-days]");
    Array.prototype.forEach.call(btns, function (x) { x.classList.remove("active"); });
  },

  applyPreset: function (d) {
    if (!this.DATA) return;
    var rots = this.DATA.rotations || [];
    if (!rots.length) return;
    var last = rots[rots.length - 1].trade_date;
    var end = last, start = "2020-01-01";
    if (d === "ytd") {
      start = last.substring(0, 4) + "-01-01";
    } else if (d !== "0") {
      var t = new Date(last);
      t.setDate(t.getDate() - parseInt(d, 10));
      start = t.toISOString().substring(0, 10);
    }
    document.getElementById("rotStart").value = start;
    document.getElementById("rotEnd").value = end;
  },

  // ------------------------------------------------ 数据加载（快照优先，失败走 API）
  load: function () {
    var self = this;
    // 内嵌快照数据优先（file:// 双击打开 / 静态托管可直接渲染）
    var inlineSnap = (window.__SNAPSHOT_DATA__ && window.__SNAPSHOT_DATA__.snapshot) || null;
    if (inlineSnap && inlineSnap.ok) {
      self.SNAP = inlineSnap;
      self.DATA = inlineSnap.backtest;
      self.enterSnapshotMode();
      self.ready();
      return;
    }
    fetch("data/snapshot.json", { cache: "no-cache" }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (snap) {
      if (snap && snap.ok) {
        self.SNAP = snap;
        self.DATA = snap.backtest;
        self.enterSnapshotMode();
        self.ready();
      } else {
        throw new Error("no snapshot");
      }
    }).catch(function () {
      fetch("/api/rotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: "2020-01-01", end: "2026-09-11" })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) throw new Error(j.error || "加载失败");
        self.DATA = j;
        self.ready();
      }).catch(function (e) {
        document.getElementById("metaInfo").textContent = "加载失败：" + e.message;
      });
    });
  },

  enterSnapshotMode: function () {
    var self = this;
    var b = document.getElementById("snapBanner");
    var s = this.SNAP;
    b.style.display = "block";
    b.innerHTML = "您正在查看<b>分享快照</b>（生成于 " + s.created_at + "，数据版本 " + s.data_version +
      "）。筛选与排序可用；生成新快照请回工作台。" +
      '<span id="verTip"></span>';
    document.getElementById("shareBtn").style.display = "none";
    // 默认还原分享时筛选（URL hash 可覆盖）
    var rf = s.rot_filter || {};
    var hash = this.readHash();
    if (hash.from || hash.to || hash.q) {
      if (hash.from) document.getElementById("rotStart").value = hash.from;
      if (hash.to) document.getElementById("rotEnd").value = hash.to;
      if (hash.q) document.getElementById("rotSearch").value = hash.q;
    } else if (rf.from || rf.to || rf.q) {
      if (rf.from) document.getElementById("rotStart").value = rf.from;
      if (rf.to) document.getElementById("rotEnd").value = rf.to;
      if (rf.q) document.getElementById("rotSearch").value = rf.q;
    }
    // 数据更新检测（仅同源可达时）
    fetch("/api/data_version").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok && j.data_version !== s.data_version) {
          document.getElementById("verTip").innerHTML =
            ' · <b class="ver-new">底层数据已更新至 ' + j.data_version +
            "</b>（本快照为 " + s.data_version + "），查看最新请回工作台运行。";
        }
      }).catch(function () { /* 静态托管跨域：跳过 */ });
  },

  readHash: function () {
    var h = location.hash.replace(/^#/, "");
    var out = {};
    h.split("&").forEach(function (kv) {
      var p = kv.split("=");
      if (p[0] === "f" && p[1]) {
        var d = p[1].split(",");
        if (d[0]) out.from = d[0];
        if (d[1]) out.to = d[1];
      } else if (p[0] === "q" && p[1]) {
        out.q = decodeURIComponent(p[1]);
      }
    });
    return out;
  },

  ready: function () {
    var rots = this.DATA.rotations || [];
    document.getElementById("metaInfo").textContent =
      "共 " + rots.length + " 次轮动/结算 · " +
      (rots.length ? rots[0].trade_date + " ~ " + rots[rots.length - 1].trade_date : "");
    this.applyFilter();
  },

  // ------------------------------------------------ 筛选（日期 + 搜索）
  filtered: function () {
    if (!this.DATA) return [];
    var from = document.getElementById("rotStart").value || "0000-01-01";
    var to = document.getElementById("rotEnd").value || "9999-12-31";
    var q = (document.getElementById("rotSearch").value || "").trim().toLowerCase();
    return (this.DATA.rotations || []).filter(function (r) {
      if (r.trade_date < from || r.trade_date > to) return false;
      if (!(r.sells || []).length && !(r.buys || []).length) return false;  // 跳过空轮动块
      if (q) {
        var hit = function (a) {
          return a && (String(a.code).toLowerCase().indexOf(q) >= 0 ||
                       String(a.name).toLowerCase().indexOf(q) >= 0);
        };
        return (r.sells || []).some(hit) || (r.buys || []).some(hit);
      }
      return true;
    });
  },

  applyFilter: function () {
    var rots = this.filtered();
    // 汇总
    var nSell = 0, nBuy = 0, pnl = 0, contrib = 0;
    rots.forEach(function (r) {
      nSell += (r.sells || []).length;
      nBuy += (r.buys || []).length;
      pnl += (r.pnl || 0);
      (r.sells || []).forEach(function (s) { contrib += (s.contrib || 0); });
    });
    var el = document.getElementById("rotSummary");
    var cls = pnl >= 0 ? "pos" : "";
    el.innerHTML =
      '<span class="s-chip"><b>' + rots.length + '</b> 次轮动/结算</span>' +
      '<span class="s-chip">调出 <b>' + nSell + '</b> 笔</span>' +
      '<span class="s-chip">调入 <b>' + nBuy + '</b> 笔</span>' +
      '<span class="s-chip">调出合计盈亏 <b class="' + cls + '">' + this.fmtPnl(pnl) + ' 元</b></span>' +
      '<span class="s-chip">合计收益贡献 <b class="' + cls + '">' + (contrib * 100).toFixed(1) + '%</b></span>';
    if (this.view === "group") {
      this.renderGroups(rots);
    } else {
      this.renderTable(rots);
    }
    this.renderHolding();
    this.syncHash();
  },

  syncHash: function () {
    var from = document.getElementById("rotStart").value;
    var to = document.getElementById("rotEnd").value;
    var q = document.getElementById("rotSearch").value.trim();
    var h = "f=" + from + "," + to + (q ? "&q=" + encodeURIComponent(q) : "");
    history.replaceState(null, "", "#" + h);
  },

  setView: function (v) {
    this.view = v;
    document.getElementById("viewGroupBtn").classList.toggle("active", v === "group");
    document.getElementById("viewTableBtn").classList.toggle("active", v === "table");
    document.getElementById("rotGroups").style.display = v === "group" ? "" : "none";
    document.getElementById("rotTableWrap").style.display = v === "table" ? "" : "none";
    this.applyFilter();
  },

  // ------------------------------------------------ 分组视图
  renderGroups: function (rotsIn) {
    var rots = rotsIn || this.filtered();
    var wrap = document.getElementById("rotGroups");
    if (!rots.length) {
      wrap.innerHTML = '<div class="empty-tip">该时间段内没有轮动记录</div>';
      return;
    }
    var list = rots.slice();
    list.sort(function (a, b) {
      return RotApp.orderDesc ? b.trade_date.localeCompare(a.trade_date)
                              : a.trade_date.localeCompare(b.trade_date);
    });
    var html = list.map(function (r) { return RotApp.groupCard(r); }).join("");
    wrap.innerHTML = html;
  },

  groupCard: function (r) {
    var isRed = r.type === "redemption";
    var title = r.trade_date + (isRed ? " 赎回结算" : " 轮动");
    var subs = [];
    subs.push("第 " + r.batch + " 批");
    if (r.signal_date) subs.push("信号日 " + r.signal_date);
    subs.push("调出 " + (r.sells || []).length + " · 调入 " + (r.buys || []).length +
              " · 保留 " + (r.holds || []).length);
    var pnlCls = (r.pnl || 0) >= 0 ? "pos" : "neg";
    var h = '<div class="rot-card card">' +
      '<header class="rot-head"><h2>' + title + '</h2>' +
      '<span class="rot-sub">' + subs.join(" ｜ ") + '</span>' +
      '<span class="rot-pnl ' + pnlCls + '">本次调出盈亏 ' + this.fmtPnl(r.pnl) + ' 元</span></header>';
    if ((r.sells || []).length) {
      h += '<div class="rot-sec-t">调出个券</div>' + this.sellTable(r.sells);
    }
    if ((r.buys || []).length) {
      h += '<div class="rot-sec-t">调入个券</div>' + this.buyTable(r.buys);
    }
    h += "</div>";
    return h;
  },

  sellTable: function (sells) {
    var rows = sells.map(function (s) {
      var retCls = (s.ret || 0) >= 0 ? "pos" : "neg";
      return "<tr>" +
        "<td>" + s.code + "</td><td class='t-name'>" + s.name + "</td>" +
        "<td><span class='dir dir-out'>调出</span></td>" +
        "<td>" + s.qty + "</td>" +
        "<td>" + s.buy_px + "</td><td>" + s.sell_px + "</td>" +
        "<td>" + s.buy_date + "~" + "</td>" +
        "<td>" + s.hold_days + "</td>" +
        "<td class='" + retCls + "'>" + (s.ret == null ? "—" : (s.ret * 100).toFixed(2) + "%") + "</td>" +
        "<td class='" + retCls + "'>" + RotApp.fmtPnl(s.pnl) + "</td>" +
        "<td>" + (s.contrib == null ? "—" : (s.contrib * 100).toFixed(2) + "%") + "</td>" +
        "<td class='t-note'>" + (s.note || "") + "</td></tr>";
    }).join("");
    return "<table class='rot-table'><thead><tr>" +
      "<th>代码</th><th>名称</th><th>方向</th><th>数量(张)</th><th>买入价</th><th>卖出价</th>" +
      "<th>买入日</th><th>持有天数</th><th>个券收益率</th><th>盈亏(元)</th><th>收益贡献</th><th>备注</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>";
  },

  buyTable: function (buys) {
    var rows = buys.map(function (s) {
      return "<tr>" +
        "<td>" + s.code + "</td><td class='t-name'>" + s.name + "</td>" +
        "<td><span class='dir dir-in'>调入</span></td>" +
        "<td>" + s.qty + "</td>" +
        "<td>" + s.px + "</td><td>—</td>" +
        "<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>" +
        "<td class='t-note'>" + (s.note || "") + "（收益于调出时结算）</td></tr>";
    }).join("");
    return "<table class='rot-table'><thead><tr>" +
      "<th>代码</th><th>名称</th><th>方向</th><th>数量(张)</th><th>买入价</th><th>卖出价</th>" +
      "<th>买入日</th><th>持有天数</th><th>个券收益率</th><th>盈亏(元)</th><th>收益贡献</th><th>备注</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>";
  },

  // ------------------------------------------------ 表格视图（可排序）
  renderTable: function (rotsIn) {
    var rots = rotsIn || this.filtered();
    var self = this;
    var recs = [];
    rots.forEach(function (r) {
      (r.sells || []).forEach(function (s) {
        recs.push({ trade_date: r.trade_date, batch: r.batch, code: s.code, name: s.name,
                    dir: "调出", qty: s.qty, buy_px: s.buy_px, sell_px: s.sell_px,
                    buy_date: s.buy_date, hold_days: s.hold_days, ret: s.ret,
                    pnl: s.pnl, contrib: s.contrib, note: s.note || "" });
      });
      (r.buys || []).forEach(function (s) {
        recs.push({ trade_date: r.trade_date, batch: r.batch, code: s.code, name: s.name,
                    dir: "调入", qty: s.qty, buy_px: s.px, sell_px: null,
                    buy_date: r.trade_date, hold_days: null, ret: null,
                    pnl: null, contrib: null, note: "调入（收益于调出时结算）" });
      });
    });
    var k = this.sortKey, desc = this.sortDesc;
    recs.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "number") return desc ? y - x : x - y;
      return desc ? String(y).localeCompare(String(x)) : String(x).localeCompare(String(y));
    });
    var cols = [
      ["trade_date", "轮动日期"], ["batch", "批次"], ["code", "代码"], ["name", "名称"],
      ["dir", "方向"], ["qty", "数量(张)"], ["buy_px", "买入价"], ["sell_px", "卖出价"],
      ["buy_date", "买入日"], ["hold_days", "持有天数"], ["ret", "个券收益率"],
      ["pnl", "盈亏(元)"], ["contrib", "收益贡献"], ["note", "备注"]
    ];
    var head = cols.map(function (c) {
      var arrow = self.sortKey === c[0] ? (self.sortDesc ? " ↓" : " ↑") : "";
      return "<th data-k='" + c[0] + "' class='sortable'>" + c[1] + arrow + "</th>";
    }).join("");
    var rows = recs.map(function (s) {
      var retCls = (s.ret || 0) >= 0 ? "pos" : "neg";
      var dirCls = s.dir === "调入" ? "dir-in" : "dir-out";
      return "<tr>" +
        "<td>" + s.trade_date + "</td><td>" + s.batch + "</td>" +
        "<td>" + s.code + "</td><td class='t-name'>" + s.name + "</td>" +
        "<td><span class='dir " + dirCls + "'>" + s.dir + "</span></td>" +
        "<td>" + s.qty + "</td><td>" + s.buy_px + "</td>" +
        "<td>" + (s.sell_px == null ? "—" : s.sell_px) + "</td>" +
        "<td>" + s.buy_date + "</td>" +
        "<td>" + (s.hold_days == null ? "—" : s.hold_days) + "</td>" +
        "<td class='" + retCls + "'>" + (s.ret == null ? "—" : (s.ret * 100).toFixed(2) + "%") + "</td>" +
        "<td class='" + retCls + "'>" + (s.pnl == null ? "—" : RotApp.fmtPnl(s.pnl)) + "</td>" +
        "<td>" + (s.contrib == null ? "—" : (s.contrib * 100).toFixed(2) + "%") + "</td>" +
        "<td class='t-note'>" + s.note + "</td></tr>";
    }).join("");
    var el = document.getElementById("rotTableWrap");
    el.innerHTML = "<header><h2>个券明细（" + recs.length + " 笔）</h2>" +
      "<p class='sub'>点击列头排序</p></header>" +
      "<div class='tw-scroll'><table class='rot-table'><thead><tr>" + head +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
    Array.prototype.forEach.call(el.querySelectorAll("th.sortable"), function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-k");
        if (self.sortKey === key) { self.sortDesc = !self.sortDesc; }
        else { self.sortKey = key; self.sortDesc = true; }
        self.renderTable();
      });
    });
  },

  // ------------------------------------------------ 持有中
  renderHolding: function () {
    var holds = (this.DATA && this.DATA.holding) || [];
    var el = document.getElementById("holdingCard");
    if (!holds.length) { el.style.display = "none"; return; }
    el.style.display = "";
    var rows = holds.map(function (s) {
      var retCls = (s.ret || 0) >= 0 ? "pos" : "neg";
      return "<tr>" +
        "<td>" + s.code + "</td><td class='t-name'>" + s.name + "</td>" +
        "<td><span class='dir dir-in'>持有中</span></td>" +
        "<td>" + s.qty + "</td><td>" + s.buy_px + "</td><td>" + s.last_px + "</td>" +
        "<td>" + s.buy_date + "</td><td>" + s.hold_days + "</td>" +
        "<td class='" + retCls + "'>" + (s.ret == null ? "—" : (s.ret * 100).toFixed(2) + "%") + "</td>" +
        "<td class='" + retCls + "'>" + RotApp.fmtPnl(s.pnl) + "</td>" +
        "<td>—</td><td class='t-note'>按最近有效收盘价估值</td></tr>";
    }).join("");
    el.innerHTML = "<header><h2>当前持有（回测期末，" + holds.length + " 只）</h2>" +
      "<p class='sub'>调入后尚未调出，收益随最新收盘价变动</p></header>" +
      "<div class='tw-scroll'><table class='rot-table'><thead><tr>" +
      "<th>代码</th><th>名称</th><th>方向</th><th>数量(张)</th><th>买入价</th><th>最新价</th>" +
      "<th>买入日</th><th>持有天数</th><th>个券收益率</th><th>浮动盈亏(元)</th><th>收益贡献</th><th>备注</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  },

  fmtPnl: function (v) {
    if (v == null) return "—";
    return (v >= 0 ? "+" : "") + Math.round(v).toLocaleString("zh-CN");
  },

  // ------------------------------------------------ 分享
  share: function () {
    var self = this;
    var btn = document.getElementById("shareBtn");
    btn.disabled = true;
    btn.textContent = "生成中…";
    var payload = {
      start: "2020-01-01", end: "2026-09-11", industries: null,
      rot_filter: {
        from: document.getElementById("rotStart").value,
        to: document.getElementById("rotEnd").value,
        q: document.getElementById("rotSearch").value.trim()
      }
    };
    fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (j) {
      btn.disabled = false;
      btn.textContent = "生成分享链接";
      if (!j.ok) { alert("生成失败：" + (j.error || "")); return; }
      var origin = location.origin;
      var url = origin + j.url;
      var html = "<div class='share-mask' onclick='this.parentNode.remove()'></div>" +
        "<div class='share-pop'>" +
        "<h3>分享快照已生成</h3>" +
        "<p class='share-url'>" + url + "</p>" +
        "<p>· 链接默认还原当前筛选（" + payload.rot_filter.from + " ~ " + payload.rot_filter.to +
        (payload.rot_filter.q ? "，搜索“" + payload.rot_filter.q + "”" : "") + "）与页面视图</p>" +
        "<p>· 三页齐全（快照版）：<a href='" + j.index_url + "'>估值分析</a> · <a href='" +
        (j.backtest_url || j.url.replace("rotations.html", "backtest.html")) +
        "'>策略回测</a> · <a href='" + j.url + "'>轮动明细</a></p>" +
        "<p class='share-note'>快照目录完全自包含（数据内嵌）：可直接双击其中 index.html 离线查看；" +
        "整目录上传 GitHub Pages / Vercel 即得长期公网链接（无需登录、不依赖本机）。目录：<br><code>" + j.dir + "</code></p>" +
        "<div class='share-btns'><button onclick='RotApp.copyUrl(\"" + url + "\")'>复制链接</button>" +
        "<button onclick='this.closest(\".share-layer\").remove()'>关闭</button></div></div>";
      var layer = document.createElement("div");
      layer.className = "share-layer";
      layer.innerHTML = html;
      document.body.appendChild(layer);
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = "生成分享链接";
      alert("生成失败：" + e.message);
    });
  },

  copyUrl: function (url) {
    var input = document.createElement("textarea");
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
    alert("链接已复制");
  }
};

document.addEventListener("DOMContentLoaded", function () { RotApp.init(); });
