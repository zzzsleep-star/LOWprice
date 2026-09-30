/* 转债估值分析 · 六图渲染模块（ECharts）
 * 配色规范：主红 #BF0000 / 中灰 #878787 / 珊瑚橙 #F18A64 / 暖米 #FBD2BE */
(function () {
  "use strict";

  const C = { red: "#BF0000", gray: "#878787", orange: "#F18A64", cream: "#FBD2BE" };
  const AXIS_LABEL = { color: "#595959", fontSize: 11 };
  const SPLIT_LINE = { lineStyle: { color: "#EFEFED" } };

  function emptyOption(text) {
    return {
      graphic: [{
        type: "text", left: "center", top: "middle",
        style: { text: text || "暂无数据", fill: "#BFBFBF", fontSize: 14 },
      }],
    };
  }

  function rangeFilter(dates, start, end) {
    const idx = [];
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] >= start && dates[i] <= end) idx.push(i);
    }
    return idx;
  }

  function pick(arr, idx) { return idx.map((i) => arr[i]); }

  /* 散点轴范围：按分位数截尾，避免极端值压扁主体 */
  function niceBounds(values, loQ, hiQ) {
    if (!values.length) return [0, 1];
    const s = values.slice().sort((a, b) => a - b);
    const lo = s[Math.floor(s.length * loQ)];
    const hi = s[Math.ceil(s.length * hiQ) - 1];
    const pad = Math.max((hi - lo) * 0.06, 0.5);
    return [Math.floor((lo - pad) * 10) / 10, Math.ceil((hi + pad) * 10) / 10];
  }

  const Valuation = {
    _charts: {},

    _get(id) {
      if (!this._charts[id]) {
        const el = document.getElementById(id);
        this._charts[id] = echarts.init(el);
      }
      return this._charts[id];
    },

    resize() { Object.keys(this._charts).forEach((k) => this._charts[k].resize()); },

    renderAll(data, range) {
      this.chart1(data, range);
      this.chart2(data);
      this.chart3(data, range);
      this.chart4(data, range);
      this.chart5(data);
      this.chart6(data);
    },

    /* 图1 月末存量余额（柱，左轴）+ 存量数量（线，右轴） */
    chart1(data, range) {
      const ch = this._get("chart1");
      const d = data.chart1;
      const idx = rangeFilter(d.dates, range.start, range.end);
      if (!idx.length) { ch.setOption(emptyOption("区间内无月末观测"), true); return; }
      const dates = pick(d.dates, idx);
      ch.setOption({
        tooltip: {
          trigger: "axis",
          formatter(ps) {
            const i = ps[0].dataIndex;
            return `${d.dates[idx[i]]}<br>` +
              `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${C.red};margin-right:6px"></span>存量余额：<b>${d.balance_yi[idx[i]].toLocaleString()}</b> 亿元<br>` +
              `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${C.gray};margin-right:6px"></span>存续数量：<b>${d.count[idx[i]]}</b> 只`;
          },
        },
        legend: { top: 0, right: 0, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 12, color: "#595959" } },
        grid: { left: 56, right: 52, top: 38, bottom: 46 },
        xAxis: {
          type: "category", data: dates, boundaryGap: true,
          axisLabel: { ...AXIS_LABEL, formatter: (v) => v.slice(0, 7) }, axisTick: { alignWithLabel: true },
        },
        yAxis: [
          { type: "value", name: "余额（亿元）", nameTextStyle: { fontSize: 11, color: "#8C8C8C" }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
          { type: "value", name: "数量（只）", nameTextStyle: { fontSize: 11, color: "#8C8C8C" }, axisLabel: AXIS_LABEL, splitLine: { show: false } },
        ],
        series: [
          {
            name: "存量余额（亿元）", type: "bar", data: pick(d.balance_yi, idx),
            itemStyle: { color: C.red }, barMaxWidth: 14,
          },
          {
            name: "存续数量（只）", type: "line", yAxisIndex: 1, data: pick(d.count, idx),
            itemStyle: { color: C.gray }, lineStyle: { color: C.gray, width: 2.5 }, symbol: "none", smooth: false,
          },
        ],
      }, true);
    },

    /* 图2 最新收盘价分布（分档配色柱状图） */
    chart2(data) {
      const ch = this._get("chart2");
      const d = data.chart2;
      const colors = [C.red, C.orange, C.gray, C.gray, C.gray, C.gray];
      const sub = document.getElementById("chart2Sub");
      if (sub) sub.textContent = `${d.snapshot_date} 存续转债收盘价分布 · 共 ${d.total} 只`;
      ch.setOption({
        tooltip: {
          trigger: "axis", axisPointer: { type: "shadow" },
          formatter(ps) {
            const b = d.bins[ps[0].dataIndex];
            return `${b.label}<br>数量：<b>${b.count}</b> 只<br>占比：<b>${b.ratio}</b>%`;
          },
        },
        grid: { left: 52, right: 24, top: 30, bottom: 40 },
        xAxis: {
          type: "category", data: d.bins.map((b) => b.label),
          axisLabel: { ...AXIS_LABEL, interval: 0, rotate: 18 },
        },
        yAxis: { type: "value", name: "数量（只）", nameTextStyle: { fontSize: 11, color: "#8C8C8C" }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
        series: [{
          type: "bar", barMaxWidth: 46,
          data: d.bins.map((b, i) => ({
            value: b.count,
            itemStyle: { color: colors[i], borderRadius: [3, 3, 0, 0] },
            label: { show: true, position: "top", color: "#595959", fontSize: 11, fontWeight: 600 },
          })),
        }],
      }, true);
    },

    /* 图3/图4 分位数三线 */
    _quantileChart(id, d, range, yName, digits) {
      const ch = this._get(id);
      const idx = rangeFilter(d.dates, range.start, range.end);
      if (!idx.length) { ch.setOption(emptyOption("区间内无观测"), true); return; }
      const mk = (name, key, color, width) => ({
        name, type: "line", data: pick(d[key], idx), symbol: "none",
        lineStyle: { color, width }, itemStyle: { color },
        emphasis: { disabled: true },
      });
      ch.setOption({
        tooltip: {
          trigger: "axis",
          formatter(ps) {
            let html = d.dates[idx[ps[0].dataIndex]] + "<br>";
            ps.forEach((p) => {
              html += `${p.marker}${p.seriesName}：<b>${p.value.toFixed(digits)}</b><br>`;
            });
            return html;
          },
        },
        legend: { top: 0, right: 0, itemWidth: 18, itemHeight: 2, textStyle: { fontSize: 12, color: "#595959" } },
        grid: { left: 52, right: 20, top: 36, bottom: 46 },
        xAxis: {
          type: "category", data: pick(d.dates, idx),
          axisLabel: { ...AXIS_LABEL, formatter: (v) => v.slice(0, 7) },
        },
        yAxis: { type: "value", name: yName, nameTextStyle: { fontSize: 11, color: "#8C8C8C" }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE, scale: true },
        series: [
          mk("P25", "p25", C.gray, 1.4),
          mk("P50", "p50", C.red, 2.6),
          mk("P75", "p75", C.orange, 1.4),
        ],
      }, true);
    },

    chart3(data, range) { this._quantileChart("chart3", data.chart3, range, "收盘价（元）", 2); },

    chart4(data, range) { this._quantileChart("chart4", data.chart4, range, "转股溢价率（%）", 2); },

    /* 图5 收盘价 × 转股溢价率 散点 */
    chart5(data) {
      const ch = this._get("chart5");
      const pts = (data.chart5 && data.chart5.points) || [];
      if (!pts.length) { ch.setOption(emptyOption(), true); return; }
      const low = [], normal = [];
      pts.forEach((p) => {
        const item = { value: [p.close, p.premium], code: p.code, name: p.name, cv: p.cv };
        if (p.close <= 110) low.push(item); else normal.push(item);
      });
      const xs = pts.map((p) => p.close), ys = pts.map((p) => p.premium);
      ch.setOption({
        tooltip: {
          trigger: "item",
          formatter(p) {
            const d = p.data;
            return `<b>${d.name}</b>（${d.code}）<br>收盘价：${d.value[0].toFixed(2)} 元<br>转股溢价率：${d.value[1].toFixed(2)}%` +
              (d.cv != null ? `<br>转股价值：${d.cv.toFixed(2)} 元` : "");
          },
        },
        legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12, color: "#595959" } },
        grid: { left: 56, right: 24, top: 36, bottom: 48 },
        xAxis: { type: "value", name: "收盘价（元）", nameTextStyle: { fontSize: 11, color: "#8C8C8C" }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE, min: niceBounds(xs, 0, 0.98)[0], max: niceBounds(xs, 0, 0.98)[1] },
        yAxis: { type: "value", name: "转股溢价率（%）", nameTextStyle: { fontSize: 11, color: "#8C8C8C" }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE, scale: true, min: niceBounds(ys, 0.01, 0.99)[0], max: niceBounds(ys, 0.01, 0.99)[1] },
        series: [
          {
            name: "≤110元", type: "scatter", data: low, symbolSize: 6.5, clip: true,
            itemStyle: { color: C.red, opacity: 0.78 },
            markArea: {
              silent: true,
              itemStyle: { color: C.cream, opacity: 0.32 },
              data: [[{ xAxis: 0 }, { xAxis: 110 }]],
            },
          },
          { name: ">110元", type: "scatter", data: normal, symbolSize: 5.5, clip: true, itemStyle: { color: C.gray, opacity: 0.45 } },
        ],
      }, true);
    },

    /* 图6 收盘价 × YTM 散点（高YTM风险提示） */
    chart6(data) {
      const ch = this._get("chart6");
      const pts = (data.chart6 && data.chart6.points) || [];
      if (!pts.length) { ch.setOption(emptyOption(), true); return; }
      const low = [], normal = [];
      pts.forEach((p) => {
        const risk = p.risk === "high" || p.risk === "extreme";
        const item = {
          value: [p.close, p.ytm], code: p.code, name: p.name,
          rating: p.rating, maturity_y: p.maturity_y, balance_yi: p.balance_yi, risk: p.risk,
          itemStyle: risk ? { borderColor: C.orange, borderWidth: 2.2 } : undefined,
        };
        if (p.risk === "extreme") {
          item.label = { show: true, formatter: p.name, position: "top", fontSize: 10, color: "#D2603A" };
        }
        if (p.close <= 110) low.push(item); else normal.push(item);
      });
      const xs = pts.map((p) => p.close), ys = pts.map((p) => p.ytm);
      ch.setOption({
        tooltip: {
          trigger: "item",
          formatter(p) {
            const d = p.data;
            return `<b>${d.name}</b>（${d.code}）<br>收盘价：${d.value[0].toFixed(2)} 元<br>YTM：${d.value[1].toFixed(2)}%` +
              `<br>信用评级：${d.rating || "—"}<br>剩余期限：${d.maturity_y != null ? d.maturity_y.toFixed(2) + " 年" : "—"}` +
              `<br>剩余规模：${d.balance_yi != null ? d.balance_yi.toFixed(2) + " 亿元" : "—"}` +
              (d.risk ? `<br><span style="color:${C.orange}">⚠ 高YTM个券，需信用风险核查</span>` : "");
          },
        },
        legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12, color: "#595959" } },
        grid: { left: 56, right: 24, top: 36, bottom: 48 },
        xAxis: { type: "value", name: "收盘价（元）", nameTextStyle: { fontSize: 11, color: "#8C8C8C" }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE, min: niceBounds(xs, 0, 0.98)[0], max: niceBounds(xs, 0, 0.98)[1] },
        yAxis: { type: "value", name: "到期收益率YTM（%）", nameTextStyle: { fontSize: 11, color: "#8C8C8C" }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE, scale: true, min: niceBounds(ys, 0.05, 1)[0], max: niceBounds(ys, 0.05, 1)[1] },
        series: [
          { name: "≤110元", type: "scatter", data: low, symbolSize: 6.5, clip: true, itemStyle: { color: C.red, opacity: 0.78 } },
          { name: ">110元", type: "scatter", data: normal, symbolSize: 5.5, clip: true, itemStyle: { color: C.gray, opacity: 0.45 } },
        ],
      }, true);
    },
  };

  window.Valuation = Valuation;
})();
