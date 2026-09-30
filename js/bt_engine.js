/* 浏览器端低价策略回测引擎 —— 严格复刻 bt_server.Backtester.run 口径
 * （分享快照部署到静态托管时，回测页在本页本地计算，无需后端）
 * 依赖：data/bt_data.js（window.__BT_DATA__，由 scripts/build_bt_data.py 生成）
 * 返回结构与 /api/backtest 完全一致，直接走 backtest.js 的 render 路径。
 * 关键对齐点：
 *  - 信号日 dates[::5]，执行日 = 信号日次一交易日，open 优先 close 兜底
 *  - 等权目标 equity/len(wanted)（含执行失败的目标券），10 张整数倍向下取整
 *  - 先卖（不在目标池/无价保留）→ 先减仓（目标内超配）→ 再买入（现金约束）
 *  - 赎回现金结算先于调仓；净值按最近有效收盘价盯市
 *  - Map 保持插入序 = Python dict 插入序；下单按代码字典序（sorted(wanted)）
 *  - 指标：pct_change 首项补 0、年化 (1+total)^(1/years)-1、样本标准差 ddof=1 */
(function () {
  "use strict";

  var INITIAL_CASH = 1000000.0;
  var TOP_K = 10, REBALANCE_EVERY = 5, LOT_SIZE = 10;

  function rnd(x, d) {
    if (x == null || !isFinite(x)) return null;
    var m = Math.pow(10, d);
    return Math.round(x * m) / m;
  }

  function run(params) {
    var D = window.__BT_DATA__;
    if (!D) return { ok: false, error: "回测数据未加载（bt_data.js 缺失）" };
    var start = params.start || D.dates[0];
    var end = params.end || D.dates[D.dates.length - 1];
    var industries = (params.industries && params.industries.length) ? params.industries : null;
    var indSet = null;
    if (industries) {
      indSet = {};
      for (var i = 0; i < industries.length; i++) indSet[industries[i]] = 1;
    }

    // 日期 → 行下标缓存
    if (!D._rowOf) {
      D._rowOf = {};
      for (var i = 0; i < D.dates.length; i++) D._rowOf[D.dates[i]] = i;
    }
    var rowOf = D._rowOf;

    // 回测区间（ISO 字符串比较 = 日期比较）
    var dates = [];
    for (var i = 0; i < D.dates.length; i++) {
      var d0 = D.dates[i];
      if (d0 >= start && d0 <= end) dates.push(d0);
    }
    if (dates.length < REBALANCE_EVERY + 2) {
      return { ok: false, error: "回测区间过短（至少约7个交易日）" };
    }

    // 信号日目标池：dates[::5] 当日截面筛选（eligible 已预计算，行业在本页过滤）
    var targets = {}, poolSize = {}, execMap = {};
    for (var k = 0; k < dates.length; k += REBALANCE_EVERY) {
      var sd = dates[k];
      var row = D.rows[rowOf[sd]];
      var cands = [];
      for (var j = 0; j < row.length; j += 4) {
        if (!row[j + 3]) continue;                            // 当日未通过筛选
        var code = D.codes[row[j]];
        if (indSet && !indSet[D.industry[code]]) continue;    // 行业剔除（缺映射同样剔除）
        cands.push([row[j + 2], code]);                       // [close, code]
      }
      poolSize[sd] = cands.length;
      // 复刻 sort_values(["close","bond_code"]).head(10)
      cands.sort(function (a, b) {
        return a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
      });
      var tg = [];
      for (var m = 0; m < cands.length && m < TOP_K; m++) tg.push(cands[m][1]);
      targets[sd] = tg;
      if (k + 1 < dates.length) execMap[k + 1] = sd;          // 执行日 = 次一交易日
    }

    var cash = INITIAL_CASH;
    var pos = new Map();   // code -> 持仓张数（插入序 = Python dict）
    var last = new Map();  // code -> 最近有效收盘价
    var navVals = [], nHold = [];

    for (var idx = 0; idx < dates.length; idx++) {
      var dt = dates[idx];
      var row = D.rows[rowOf[dt]];

      // 收盘价更新（最近有效价）
      for (var j = 0; j < row.length; j += 4) {
        var cl = row[j + 2];
        if (cl !== null) last.set(D.codes[row[j]], cl);
      }

      // 赎回现金结算（先于调仓）
      pos.forEach(function (qty, code) {
        var ev = D.events[code];
        if (ev && ev[0] <= dt) {
          cash += qty * ev[1];
          pos.delete(code);
        }
      });

      // 调仓执行（T+1 开盘）
      var sd = execMap[idx];
      if (sd !== undefined) {
        var wanted = targets[sd].slice();   // 副本，随后按代码排序（= sorted(wanted)）
        var wantedSet = {};
        for (var w = 0; w < wanted.length; w++) wantedSet[wanted[w]] = 1;
        var ox = {};
        for (var j = 0; j < row.length; j += 4) {
          var o = row[j + 1];
          ox[D.codes[row[j]]] = (o !== null) ? o : row[j + 2];  // open 优先 close 兜底
        }
        // 先卖（不在目标池；无执行价保留持仓）
        pos.forEach(function (qty, code) {
          if (!wantedSet[code]) {
            var px = ox[code];
            if (px === undefined) return;
            cash += qty * px;
            pos.delete(code);
          }
        });
        var equity = cash;
        pos.forEach(function (qty, code) { equity += qty * (last.get(code) || 0); });
        // 目标市值与下单量（等权、10 张整数倍；分母=目标池数，含执行失败个券）
        wanted.sort();
        var wl = wanted.length;
        var orders = [];
        for (var w = 0; w < wl; w++) {
          var px = ox[wanted[w]];
          if (px === undefined || px <= 0) continue;
          var desired = Math.floor(equity / wl / px / LOT_SIZE) * LOT_SIZE;
          orders.push([wanted[w], px, desired]);
        }
        // 先减仓（目标内超配）
        for (var q = 0; q < orders.length; q++) {
          var code = orders[q][0], px = orders[q][1], desired = orders[q][2];
          var have = pos.get(code) || 0;
          if (desired < have) {
            cash += (have - desired) * px;
            if (desired === 0) pos.delete(code); else pos.set(code, desired);
          }
        }
        // 再买入（现金约束下逐券成交）
        for (var q = 0; q < orders.length; q++) {
          var code = orders[q][0], px = orders[q][1], desired = orders[q][2];
          var have = pos.get(code) || 0;
          if (desired > have) {
            var affordable = Math.floor(cash / px / LOT_SIZE) * LOT_SIZE;
            var qty = Math.min(desired - have, affordable);
            if (qty > 0) {
              cash -= qty * px;
              pos.set(code, have + qty);
            }
          }
        }
      }

      var nav = cash;
      pos.forEach(function (qty, code) { nav += qty * (last.get(code) || 0); });
      navVals.push(nav);
      nHold.push(pos.size);
    }

    // ---- 指标（与服务器口径一致）----
    var n = navVals.length;
    var navS = new Array(n), r = new Array(n);
    for (var i = 0; i < n; i++) navS[i] = navVals[i] / INITIAL_CASH;
    r[0] = 0;
    for (var i = 1; i < n; i++) r[i] = navS[i] / navS[i - 1] - 1;
    var years = Math.max(n / 252, 1 / 252);
    var total = navS[n - 1] - 1;
    var ann = total > -1 ? Math.pow(1 + total, 1 / years) - 1 : -1;
    var mean = 0;
    for (var i = 0; i < n; i++) mean += r[i];
    mean /= n;
    var vv = 0;
    for (var i = 0; i < n; i++) { var e = r[i] - mean; vv += e * e; }
    var vol = n > 1 ? Math.sqrt(vv / (n - 1) * 252) : 0;
    var sharpe = vol ? ann / vol : null;
    var peak = -Infinity, mdd = 0;
    for (var i = 0; i < n; i++) {
      if (navS[i] > peak) peak = navS[i];
      var dd = navS[i] / peak - 1;
      if (dd < mdd) mdd = dd;
    }

    // ---- 基准：区间截取 → 对齐回测日 → ffill/bfill → 归一 ----
    var benchList = null, benchTotal = null;
    var hasBench = false;
    for (var i = 0; i < n; i++) { if (D.bench[rowOf[dates[i]]] > 0) { hasBench = true; break; } }
    if (hasBench) {
      var v = new Array(n), prev = 0;
      for (var i = 0; i < n; i++) {
        var bv = D.bench[rowOf[dates[i]]];
        if (bv > 0) prev = bv;
        v[i] = prev;                    // ffill
      }
      var next = 0;
      for (var i = n - 1; i >= 0; i--) {
        var bv = D.bench[rowOf[dates[i]]];
        if (bv > 0) next = bv;
        if (!v[i]) v[i] = next;         // bfill（前导缺失）
      }
      var v0 = v[0];
      benchList = new Array(n);
      for (var i = 0; i < n; i++) benchList[i] = rnd(v[i] / v0 - 1, 6);
      benchTotal = v[n - 1] / v0 - 1;
    }
    var excess = hasBench ? total - benchTotal : null;

    var pools = [];
    for (var key in poolSize) if (poolSize[key]) pools.push(poolSize[key]);
    var avgPool = 0;
    for (var i = 0; i < pools.length; i++) avgPool += pools[i];
    if (pools.length) avgPool /= pools.length;

    var strategy = new Array(n);
    for (var i = 0; i < n; i++) strategy[i] = rnd(navS[i] - 1, 6);

    return {
      ok: true,
      dates: dates,
      strategy: strategy,
      benchmark: benchList,
      metrics: {
        cumulative_return: rnd(total, 4),
        annualized_return: rnd(ann, 4),
        excess_return: excess === null ? null : rnd(excess, 4),
        max_drawdown: rnd(mdd, 4),
        sharpe: sharpe === null ? null : rnd(sharpe, 2),
        annualized_volatility: rnd(vol, 4),
        benchmark_return: benchTotal === null ? null : rnd(benchTotal, 4),
      },
      meta: {
        signal_days: Math.ceil(dates.length / REBALANCE_EVERY),
        avg_pool_size: rnd(avgPool, 1),
        holding_count_end: nHold[n - 1],
      },
    };
  }

  window.BTEngine = { run: run };
})();
