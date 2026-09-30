/* 平台入口：数据加载、时间区间控制、模块调度 */
(function () {
  "use strict";

  const App = {
    data: null,

    async init() {
      let data = null;
      // 分享快照：优先使用内嵌数据（file:// 双击打开 / 任意静态托管均可）
      if (window.__SNAPSHOT_DATA__ && window.__SNAPSHOT_DATA__.valuation) {
        data = window.__SNAPSHOT_DATA__.valuation;
        this.showSnapshotBanner(window.__SNAPSHOT_DATA__.snapshot);
      } else {
        // 在线加载：依次尝试 快照目录 / 平台数据目录
        for (const p of ["data/valuation.json", "../data/valuation.json"]) {
          try {
            const res = await fetch(p, { cache: "no-cache" });
            if (res.ok) { data = await res.json(); break; }
          } catch (e) {
            /* file:// 协议下 fetch 受限 */
          }
        }
      }
      if (!data) {
        this.showLoadError();
        return;
      }
      this.data = data;

      const m = this.data.meta;
      document.getElementById("metaInfo").textContent =
        `截面日期 ${m.snapshot_date} · 覆盖 ${m.universe} 只转债 · 数据生成于 ${m.generated_at.replace("T", " ")}`;
      document.querySelectorAll("#snapDate, .snap").forEach((el) => { el.textContent = m.snapshot_date; });

      const start = document.getElementById("startDate");
      const end = document.getElementById("endDate");
      start.value = m.hist_start;
      end.value = m.snapshot_date;
      start.max = m.snapshot_date;
      end.max = m.snapshot_date;

      start.addEventListener("change", () => { this.clearPresetActive(); this.renderAll(); });
      end.addEventListener("change", () => { this.clearPresetActive(); this.renderAll(); });
      document.querySelectorAll(".preset").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".preset").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          const days = parseInt(btn.dataset.days, 10);
          const endD = new Date(m.snapshot_date + "T00:00:00");
          if (days > 0) {
            const st = new Date(endD.getTime() - days * 86400000);
            start.value = this.toISO(st);
            end.value = m.snapshot_date;
          } else {
            start.value = m.hist_start;
            end.value = m.snapshot_date;
          }
          this.renderAll();
        });
      });

      this.renderAll();
      window.addEventListener("resize", () => Valuation.resize());
    },

    toISO(d) {
      const p = (n) => (n < 10 ? "0" + n : "" + n);
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    },

    range() {
      const m = this.data.meta;
      const s = document.getElementById("startDate").value || m.hist_start;
      const e = document.getElementById("endDate").value || m.snapshot_date;
      return s <= e ? { start: s, end: e } : { start: e, end: s };
    },

    clearPresetActive() {
      document.querySelectorAll(".preset").forEach((b) => b.classList.remove("active"));
    },

    renderAll() {
      if (this.data) Valuation.renderAll(this.data, this.range());
    },

    showSnapshotBanner(snap) {
      const banner = document.createElement("div");
      banner.className = "snap-banner";
      banner.style.display = "block";
      banner.innerHTML =
        `您正在查看<b>分享快照</b>（生成于 ${snap.created_at}，数据版本 ${snap.data_version}）。` +
        "区间筛选可用；生成新快照请回工作台。";
      const controls = document.querySelector(".controls");
      if (controls) controls.before(banner);
    },

    showLoadError() {
      const grid = document.getElementById("chartGrid");
      grid.innerHTML =
        '<div class="error-box">数据加载失败：直接以 file:// 打开时无法读取本地 JSON。<br>' +
        "请运行工作台根目录的「启动工作台.bat」，或手动启动服务：<br>" +
        "<code>py -3.9 d:\\固收回测\\platform\\scripts\\bt_server.py</code><br>" +
        "然后浏览器打开 http://localhost:8001/web/index.html</div>";
    },
  };

  document.addEventListener("DOMContentLoaded", () => App.init());
})();
