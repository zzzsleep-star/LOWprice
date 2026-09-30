/* 页面二：低价策略回测 · 交互与渲染
 * 配色规范：主红 #BF0000（策略/主操作/正向结果）· 中灰 #878787（基准/辅助）
 *          珊瑚橙 #F18A64（超额收益）· 暖米 #FBD2BE（悬停/券池状态） */
(function () {
  "use strict";

  var C = { red: "#BF0000", gray: "#878787", orange: "#F18A64", cream: "#FBD2BE",
            ink: "#29290F", line: "#E8E8E8" };
  var DATA_END = "2026-09-11", DATA_START = "2020-01-01";

  var App = {
    industries: [],          // [{name, count}]（按转债数量降序）
    selected: new Set(),     // 已选行业
    chart: null,
    running: false,

    // ------------------------------------------------------------ 初始化
    init: function () {
      var self = this;
      document.getElementById("runBtn").addEventListener("click", function () { self.runBacktest(); });

      // 快捷区间按钮（仅改日期，回测由"运行回测"触发）
      Array.prototype.forEach.call(document.querySelectorAll(".btn-group .preset"), function (btn) {
        btn.addEventListener("click", function () {
          Array.prototype.forEach.call(document.querySelectorAll(".btn-group .preset"), function (b) {
            b.classList.remove("active");
          });
          btn.classList.add("active");
          var y = parseInt(btn.dataset.years, 10);
          var end = document.getElementById("btEnd");
          end.value = DATA_END;
          if (y > 0) {
            var e = new Date(DATA_END + "T00:00:00");
            e.setFullYear(e.getFullYear() - y);
            var s = document.getElementById("btStart");
            s.value = self.toISO(e);
          } else {
            document.getElementById("btStart").value = DATA_START;
          }
        });
      });

      // 手动改日期时清除快捷按钮选中态
      ["btStart", "btEnd"].forEach(function (id) {
        document.getElementById(id).addEventListener("change", function () {
          Array.prototype.forEach.call(document.querySelectorAll(".btn-group .preset"), function (b) {
            b.classList.remove("active");
          });
        });
      });

      // 全市场 radio：勾选则清空行业
      document.getElementById("allMarketRadio").addEventListener("change", function () {
        if (this.checked) {
          self.selected.clear();
          Array.prototype.forEach.call(document.querySelectorAll(".ind-item input"), function (cb) {
            cb.checked = false;
          });
          self.updatePoolStatus();
        }
      });

      // 行业搜索
      document.getElementById("indSearch").addEventListener("input", function () {
        self.renderIndustries(this.value.trim());
      });

      // 分享快照模式优先：内嵌数据（file:// 可用）→ 快照 json → 在线模式
      var inlineSnap = (window.__SNAPSHOT_DATA__ && window.__SNAPSHOT_DATA__.snapshot) || null;
      if (inlineSnap && inlineSnap.ok) { self.enterSnapshot(inlineSnap); return; }
      fetch("data/snapshot.json", { cache: "no-cache" }).then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (snap) {
        if (snap && snap.ok) { self.enterSnapshot(snap); return; }
        throw new Error("no snapshot");
      }).catch(function () {
        self.loadIndustries().then(function () {
          self.runBacktest();   // 初始自动跑一次（全市场 · 全区间）
        });
      });
    },

    enterSnapshot: function (snap) {
      var self = this;
      this.snapshotMode = true;
      this.industries = snap.industries || [];
      var p = snap.params || {};
      document.getElementById("btStart").value = p.start || DATA_START;
      document.getElementById("btEnd").value = p.end || DATA_END;
      var banner = document.createElement("div");
      banner.className = "snap-banner";
      banner.style.display = "block";
      banner.innerHTML = "您正在查看<b>分享快照</b>（生成于 " + snap.created_at +
        "，数据版本 " + snap.data_version +
        "）。支持交互回测：日期与行业筛选在本页本地计算，无需服务器；查看最新数据请回工作台。";
      document.querySelector(".bt-controls").after(banner);
      document.getElementById("metaInfo").textContent =
        "策略：低价轮动（10只 · 5日调仓） · 基准：中证转债指数 · 分享快照（本地交互）";
      this.renderIndustries("");
      this.updatePoolStatus();
      if (snap.backtest && snap.backtest.ok) {
        this.render(snap.backtest, p.start || DATA_START, p.end || DATA_END);
      }
      // 后台预载本地引擎数据（首次约几秒，点"运行回测"时已就绪）
      this.loadEngineData().catch(function () {});
    },

    // 快照模式：动态加载本地引擎数据（13MB，仅快照版回测页需要）
    loadEngineData: function () {
      if (window.__BT_DATA__) return Promise.resolve();
      if (this._enginePromise) return this._enginePromise;
      this._enginePromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "data/bt_data.js";
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error("data/bt_data.js 加载失败")); };
        document.head.appendChild(s);
      });
      return this._enginePromise;
    },

    toISO: function (d) {
      var p = function (n) { return n < 10 ? "0" + n : "" + n; };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    },

    // ------------------------------------------------------------ 行业列表
    loadIndustries: function () {
      var self = this;
      return fetch("/api/industries").then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) throw new Error(j.error || "加载行业失败");
        self.industries = j.industries || [];
        document.getElementById("metaInfo").textContent =
          "策略：低价轮动（10只 · 5日调仓） · 基准：中证转债指数 · 覆盖 " +
          j.universe + " 只转债 / " + self.industries.length + " 个申万一级行业" +
          (j.unclassified ? "（" + j.unclassified + " 只正股未分类）" : "");
        self.renderIndustries("");
      }).catch(function (e) {
        document.getElementById("indList").innerHTML =
          '<div class="ind-loading">行业数据加载失败：' + e.message + "</div>";
        document.getElementById("metaInfo").textContent = "行业数据加载失败（回测仍可用全市场）";
      });
    },

    renderIndustries: function (filter) {
      var self = this;
      var box = document.getElementById("indList");
      var items = this.industries.filter(function (it) {
        return !filter || it.name.indexOf(filter) >= 0;
      });
      if (!items.length) {
        box.innerHTML = '<div class="ind-loading">无匹配行业</div>';
        return;
      }
      box.innerHTML = items.map(function (it) {
        var checked = self.selected.has(it.name) ? " checked" : "";
        return '<label class="ind-item"><input type="checkbox" data-ind="' + it.name + '"' + checked + '>' +
          "<span>" + it.name + "</span><em>" + it.count + " 只</em></label>";
      }).join("");
      Array.prototype.forEach.call(box.querySelectorAll("input"), function (cb) {
        cb.addEventListener("change", function () {
          if (this.checked) self.selected.add(this.dataset.ind);
          else self.selected.delete(this.dataset.ind);
          // 勾选任一行业 → 退出全市场；全部取消 → 回到全市场
          document.getElementById("allMarketRadio").checked = self.selected.size === 0;
          self.updatePoolStatus();
        });
      });
    },

    updatePoolStatus: function () {
      var el = document.getElementById("poolStatus");
      if (!this.selected.size) {
        el.innerHTML = "当前券池：<b>全市场</b>";
      } else {
        var names = Array.from(this.selected).join("、");
        el.innerHTML = "当前券池：" + names.split("、").map(function (n) {
          return "<b>" + n + "</b>";
        }).join("、");
      }
    },

    // ------------------------------------------------------------ 运行回测
    runBacktest: function () {
      var self = this;
      if (this.running) return;
      var start = document.getElementById("btStart").value || DATA_START;
      var end = document.getElementById("btEnd").value || DATA_END;
      if (start > end) { var t = start; start = end; end = t; }
      var industries = this.selected.size ? Array.from(this.selected) : null;

      var btn = document.getElementById("runBtn");
      this.running = true;
      btn.disabled = true;
      btn.textContent = "回测中…";
      this.setMetrics(null);   // 指标先置空

      // 快照模式：本地引擎计算（静态托管可交互）
      if (this.snapshotMode) {
        self.loadEngineData().then(function () {
          var j = window.BTEngine.run({ start: start, end: end, industries: industries });
          self.running = false;
          btn.disabled = false;
          btn.textContent = "运行回测";
          if (!j.ok) {
            self.chart && self.chart.setOption({ graphic: [{ type: "text", left: "center", top: "middle",
              style: { text: j.error || "回测失败", fill: "#BFBFBF", fontSize: 14 } }] }, true);
            return;
          }
          self.render(j, start, end);
        }).catch(function (e) {
          self.running = false;
          btn.disabled = false;
          btn.textContent = "运行回测";
          self.chart && self.chart.setOption({ graphic: [{ type: "text", left: "center", top: "middle",
            style: { text: "本地引擎不可用：" + e.message, fill: "#BFBFBF", fontSize: 14 } }] }, true);
        });
        return;
      }

      fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: start, end: end, industries: industries }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        self.running = false;
        btn.disabled = false;
        btn.textContent = "运行回测";
        if (!j.ok) {
          self.chart && self.chart.setOption({ graphic: [{ type: "text", left: "center", top: "middle",
            style: { text: j.error || "回测失败", fill: "#BFBFBF", fontSize: 14 } }] }, true);
          return;
        }
        self.render(j, start, end);
      }).catch(function (e) {
        self.running = false;
        btn.disabled = false;
        btn.textContent = "运行回测";
        self.chart && self.chart.setOption({ graphic: [{ type: "text", left: "center", top: "middle",
          style: { text: "请求失败：" + e.message, fill: "#BFBFBF", fontSize: 14 } }] }, true);
      });
    },

    // ------------------------------------------------------------ 渲染
    render: function (j, start, end) {
      document.getElementById("btRangeLabel").textContent = start + " ~ " + end;
      this.renderChart(j);
      this.setMetrics(j.metrics);
    },

    renderChart: function (j) {
      if (!this.chart) {
        this.chart = echarts.init(document.getElementById("btChart"));
      }
      var hasBench = j.benchmark && j.benchmark.length === j.dates.length;
      var series = [{
        name: "低价策略", type: "line", data: j.strategy, symbol: "none",
        lineStyle: { color: C.red, width: 2.5 }, itemStyle: { color: C.red },
        emphasis: { disabled: true },
      }];
      if (hasBench) {
        series.push({
          name: "基准指数", type: "line", data: j.benchmark, symbol: "none",
          lineStyle: { color: C.gray, width: 2 }, itemStyle: { color: C.gray },
          emphasis: { disabled: true },
        });
      }
      this.chart.setOption({
        animation: false,
        tooltip: {
          trigger: "axis",
          backgroundColor: "#FFFFFF", borderColor: C.line, borderWidth: 1,
          textStyle: { color: C.ink, fontSize: 12 },
          extraCssText: "box-shadow:0 2px 8px rgba(0,0,0,0.10);",
          formatter: function (ps) {
            var html = ps[0].axisValue + "<br>";
            ps.forEach(function (p) {
              var color = p.seriesName === "低价策略" ? C.red : C.gray;
              var v = (p.value * 100).toFixed(2);
              html += '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;' +
                "background:" + color + ';margin-right:6px"></span>' +
                p.seriesName + '：<b style="color:' + color + '">' +
                (v > 0 ? "+" + v : v) + "%</b><br>";
            });
            return html;
          },
        },
        legend: { top: 0, right: 0, itemWidth: 18, itemHeight: 2,
                  textStyle: { fontSize: 12, color: "#595959" } },
        grid: { left: 64, right: 24, top: 36, bottom: 42 },
        xAxis: {
          type: "category", data: j.dates, boundaryGap: false,
          axisLabel: { color: "#595959", fontSize: 11, formatter: function (v) { return v.slice(0, 7); } },
          axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false },
        },
        yAxis: {
          type: "value", name: "累计收益率（%）",
          nameTextStyle: { fontSize: 11, color: "#8C8C8C" },
          axisLabel: { color: "#595959", fontSize: 11,
                       formatter: function (v) { return (v * 100).toFixed(0) + "%"; } },
          splitLine: { lineStyle: { color: C.line } },   // 仅横向网格线
        },
        series: series,
      }, true);
    },

    setMetrics: function (m) {
      var pct = function (v, signed) {
        if (v == null) return "—";
        var s = (v * 100).toFixed(2);
        return (signed && v > 0 ? "+" : "") + s + "%";
      };
      document.getElementById("mCum").textContent = m ? pct(m.cumulative_return, true) : "—";
      document.getElementById("mAnn").textContent = m ? pct(m.annualized_return, true) : "—";
      document.getElementById("mExc").textContent = m ? pct(m.excess_return, true) : "—";
      document.getElementById("mMdd").textContent = m ? pct(m.max_drawdown) : "—";
      document.getElementById("mSharpe").textContent = m && m.sharpe != null ? m.sharpe.toFixed(2) : "—";
      document.getElementById("mVol").textContent = m ? pct(m.annualized_volatility) : "—";
      // 超额收益颜色：正珊瑚橙 / 负中灰
      var exc = document.getElementById("mExc");
      if (m && m.excess_return != null) {
        exc.style.color = m.excess_return >= 0 ? C.orange : C.gray;
      } else {
        exc.style.color = "";
      }
    },
  };

  window.addEventListener("resize", function () {
    if (App.chart) App.chart.resize();
  });
  document.addEventListener("DOMContentLoaded", function () { App.init(); });
})();
