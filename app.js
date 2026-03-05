(() => {
  const data = window.SURVEY_DATA;
  if (!data || !Array.isArray(data.respondents)) {
    document.body.insertAdjacentHTML(
      "beforeend",
      "<p style='padding:1rem;color:#b91c1c'>데이터를 불러오지 못했습니다. survey-data.js를 확인해주세요.</p>"
    );
    return;
  }

  const MODE_LABELS = data.labels.modes;
  const MODE_KEYS = Object.keys(MODE_LABELS);
  const PERSONAL_BUDGET_ORDER = ["부담할 수 없다", "-5만 원", "5-10만 원", "10-20만 원", "20-30만 원", "40만 원-"];
  const TOTAL_BUDGET_ORDER = ["-10만 원", "10-30만 원", "30-50만 원", "100만 원 이상"];
  const COLORS = {
    low: "#B7A8FB",
    mid: "#F5E7A1",
    high: "#FC8B57",
    text: "#1A1822",
    grid: "rgba(26, 24, 34, 0.14)",
  };

  const filters = {
    program: new Set(data.dimensions.programs),
    major: new Set(data.dimensions.majors),
    studio: new Set(data.dimensions.studios),
  };

  const filterMeta = [
    { key: "program", title: "과정", values: data.dimensions.programs },
    { key: "major", title: "세부전공", values: data.dimensions.majors },
    { key: "studio", title: "스튜디오", values: data.dimensions.studios },
  ];

  const container = document.getElementById("filterContainer");
  const resetBtn = document.getElementById("resetFilters");
  const closeFiltersBtn = document.getElementById("closeFilters");
  const filtersPanel = document.getElementById("filtersPanel");
  const filtersBackdrop = document.getElementById("filtersBackdrop");
  const insightList = document.getElementById("insightList");

  function average(values) {
    if (!values.length) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  function meanCI(values, z = 1.96) {
    const nums = values.filter((v) => Number.isFinite(v));
    const n = nums.length;
    if (!n) return { n: 0, mean: null, low: null, high: null };
    const m = average(nums);
    if (n === 1) return { n, mean: m, low: m, high: m };
    const variance = nums.reduce((sum, v) => sum + (v - m) ** 2, 0) / (n - 1);
    const se = Math.sqrt(variance) / Math.sqrt(n);
    return { n, mean: m, low: m - z * se, high: m + z * se };
  }

  function proportionPct(count, total) {
    if (!total) return 0;
    return (count / total) * 100;
  }

  function rankToWeight(rank) {
    if (rank === 1) return 3;
    if (rank === 2) return 2;
    if (rank === 3) return 1;
    return 0;
  }

  function safeId(prefix, value) {
    return `${prefix}-${String(value).replace(/[^\w가-힣]+/g, "-")}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function chartLayout(layout) {
    return {
      ...layout,
      font: { color: COLORS.text, family: "Space Mono, IBM Plex Sans KR, sans-serif", size: 12 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
    };
  }

  function hexToRgb(hex) {
    const value = hex.replace("#", "");
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  function rgbToHex({ r, g, b }) {
    const toHex = (v) => Math.round(v).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function interpolateColor(lowHex, highHex, t) {
    const low = hexToRgb(lowHex);
    const high = hexToRgb(highHex);
    return rgbToHex({
      r: low.r + (high.r - low.r) * t,
      g: low.g + (high.g - low.g) * t,
      b: low.b + (high.b - low.b) * t,
    });
  }

  function relativeColors(values) {
    const nums = values.map((v) => (Number.isFinite(v) ? v : 0));
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    return relativeColorsWithRange(nums, min, max);
  }

  function relativeColorsWithRange(values, min, max) {
    const nums = values.map((v) => (Number.isFinite(v) ? v : 0));
    if (max === min) {
      return nums.map(() => COLORS.mid);
    }
    return nums.map((v) => {
      const t = (v - min) / (max - min);
      if (t <= 0.5) {
        return interpolateColor(COLORS.low, COLORS.mid, t * 2);
      }
      return interpolateColor(COLORS.mid, COLORS.high, (t - 0.5) * 2);
    });
  }

  function filteredRows() {
    return data.respondents.filter(
      (row) => filters.program.has(row.program) && filters.major.has(row.major) && filters.studio.has(row.studio)
    );
  }

  function renderFilters() {
    container.innerHTML = "";

    filterMeta.forEach((group) => {
      const el = document.createElement("section");
      el.className = "filter-group";

      const title = document.createElement("h3");
      title.textContent = group.title;
      el.appendChild(title);

      const actions = document.createElement("div");
      actions.className = "filter-actions";

      const allBtn = document.createElement("button");
      allBtn.className = "mini-btn";
      allBtn.type = "button";
      allBtn.textContent = "전체";
      allBtn.addEventListener("click", () => {
        filters[group.key] = new Set(group.values);
        renderFilters();
        render();
      });

      const noneBtn = document.createElement("button");
      noneBtn.className = "mini-btn";
      noneBtn.type = "button";
      noneBtn.textContent = "해제";
      noneBtn.addEventListener("click", () => {
        filters[group.key] = new Set();
        renderFilters();
        render();
      });

      actions.appendChild(allBtn);
      actions.appendChild(noneBtn);
      el.appendChild(actions);

      const options = document.createElement("div");
      options.className = "filter-options";

      group.values.forEach((value) => {
        const id = safeId(group.key, value);
        const label = document.createElement("label");
        label.className = "filter-option";
        label.setAttribute("for", id);

        const input = document.createElement("input");
        input.type = "checkbox";
        input.id = id;
        input.checked = filters[group.key].has(value);
        input.addEventListener("change", (event) => {
          if (event.target.checked) {
            filters[group.key].add(value);
          } else {
            filters[group.key].delete(value);
          }
          render();
        });

        const text = document.createElement("span");
        text.textContent = value;

        label.appendChild(input);
        label.appendChild(text);
        options.appendChild(label);
      });

      el.appendChild(options);
      container.appendChild(el);
    });
  }

  function modeWeightedScores(rows) {
    const scores = Object.fromEntries(MODE_KEYS.map((k) => [k, 0]));
    rows.forEach((row) => {
      MODE_KEYS.forEach((modeKey) => {
        scores[modeKey] += rankToWeight(row.mode_ranking[modeKey]);
      });
    });
    return scores;
  }

  function scoreRanking(rows, fieldName, labels) {
    const points = Object.fromEntries(labels.map((label) => [label, 0]));
    rows.forEach((row) => {
      const ranking = row[fieldName] || {};
      labels.forEach((label) => {
        const rank = ranking[label];
        points[label] += rankToWeight(rank);
      });
    });
    return points;
  }

  function rankingTop(rows, fieldName, labels) {
    const scores = scoreRanking(rows, fieldName, labels);
    const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
    const validCount = rows.filter((row) =>
      labels.some((label) => Number.isFinite((row[fieldName] || {})[label]))
    ).length;
    return { scores, top, validCount };
  }

  function setFiltersPanelOpen(isOpen) {
    filtersPanel.classList.toggle("is-open", isOpen);
    filtersBackdrop.classList.toggle("is-open", isOpen);
    filtersPanel.setAttribute("aria-hidden", String(!isOpen));
  }

  function toggleFiltersPanel() {
    const open = !filtersPanel.classList.contains("is-open");
    setFiltersPanelOpen(open);
  }

  function renderModeTopChart(rows) {
    const stats = MODE_KEYS.map((key) => {
      const values = rows.map((row) => rankToWeight(row.mode_ranking[key]));
      const ci = meanCI(values);
      return {
        key,
        label: MODE_LABELS[key],
        mean: Number(ci.mean.toFixed(3)),
        low: ci.low,
        high: ci.high,
      };
    }).sort((a, b) => b.mean - a.mean);
    const y = stats.map((s) => s.label);
    const x = stats.map((s) => s.mean);
    const errPlus = stats.map((s) => Math.max(0, s.high - s.mean));
    const errMinus = stats.map((s) => Math.max(0, s.mean - s.low));

    Plotly.react(
      "modeTopChart",
      [
        {
          type: "scatter",
          mode: "markers+text",
          y,
          x,
          marker: {
            color: relativeColors(x),
            line: { color: "#8D8EA0", width: 1.2 },
            size: 12,
          },
          text: x.map((v) => v.toFixed(2)),
          textposition: "right",
          error_x: {
            type: "data",
            symmetric: false,
            array: errPlus,
            arrayminus: errMinus,
            color: "#6B6979",
            thickness: 1.2,
            width: 4,
          },
          hovertemplate: "%{y}<br>평균 점수 %{x:.2f}<extra></extra>",
        },
      ],
      chartLayout({
        margin: { t: 12, r: 30, b: 45, l: 150 },
        yaxis: {
          automargin: true,
        },
        xaxis: {
          title: `평균 점수(0-3, 95% CI, n=${rows.length})`,
          range: [0, 3],
          gridcolor: COLORS.grid,
        },
      }),
      { responsive: true, displaylogo: false }
    );
  }

  function renderGroupDotChart(rows) {
    const groups = Array.from(new Set(rows.map((row) => row.major).filter(Boolean)).values()).sort();
    const stats = groups
      .map((group) => {
        const vals = rows.filter((row) => row.major === group).map((row) => row.offline_stance);
        const ci = meanCI(vals);
        return {
          group,
          n: ci.n,
          mean: ci.mean,
          low: ci.low,
          high: ci.high,
        };
      })
      .filter((s) => Number.isFinite(s.mean))
      .sort((a, b) => b.mean - a.mean);

    const y = stats.map((s) => `${s.group} (n=${s.n})`);
    const x = stats.map((s) => Number(s.mean.toFixed(2)));
    const errPlus = stats.map((s) => Math.max(0, s.high - s.mean));
    const errMinus = stats.map((s) => Math.max(0, s.mean - s.low));

    Plotly.react(
      "groupDotChart",
      [
        {
          type: "scatter",
          mode: "markers+text",
          y,
          x,
          marker: {
            size: 11,
            color: relativeColors(x),
            line: { width: 1, color: "#8D8EA0" },
          },
          text: x.map((v) => v.toFixed(2)),
          textposition: "right",
          error_x: {
            type: "data",
            symmetric: false,
            array: errPlus,
            arrayminus: errMinus,
            color: "#6B6979",
            thickness: 1.2,
            width: 4,
          },
          hovertemplate: "%{y}<br>평균 %{x:.2f}<extra></extra>",
        },
      ],
      chartLayout({
        margin: { t: 12, r: 30, b: 45, l: 180 },
        xaxis: { title: "오프라인 전시 입장 평균(1-5, 95% CI)", range: [1, 5], gridcolor: COLORS.grid },
        yaxis: { automargin: true },
      }),
      { responsive: true, displaylogo: false }
    );
  }

  function buildBudgetRates(rows) {
    const personalCounts = Object.fromEntries(PERSONAL_BUDGET_ORDER.map((label) => [label, 0]));
    const totalCounts = Object.fromEntries(TOTAL_BUDGET_ORDER.map((label) => [label, 0]));
    let personalValid = 0;
    let totalValid = 0;

    rows.forEach((row) => {
      const personalSelected = row.personal_budget.selected || [];
      const totalSelected = row.total_budget.selected || [];
      if (personalSelected.length) personalValid += 1;
      if (totalSelected.length) totalValid += 1;

      personalSelected.forEach((label) => {
        if (personalCounts[label] !== undefined) personalCounts[label] += 1;
      });
      totalSelected.forEach((label) => {
        if (totalCounts[label] !== undefined) totalCounts[label] += 1;
      });
    });
    return {
      personalValues: PERSONAL_BUDGET_ORDER.map((label) => proportionPct(personalCounts[label], personalValid)),
      totalValues: TOTAL_BUDGET_ORDER.map((label) => proportionPct(totalCounts[label], totalValid)),
      personalValid,
      totalValid,
    };
  }

  function renderPersonalBudgetChart(rows) {
    const { personalValues, personalValid } = buildBudgetRates(rows);
    const minV = Math.min(...personalValues);
    const maxV = Math.max(...personalValues);

    Plotly.react(
      "personalBudgetChart",
      [
        {
          type: "bar",
          orientation: "h",
          y: PERSONAL_BUDGET_ORDER,
          x: personalValues,
          marker: { color: relativeColorsWithRange(personalValues, minV, maxV) },
          text: personalValues.map((v) => `${v.toFixed(1)}%`),
          textposition: "outside",
          hovertemplate: "%{y}: %{x:.1f}%<extra></extra>",
        },
      ],
      chartLayout({
        margin: { t: 12, r: 10, b: 40, l: 110 },
        xaxis: { title: `비율(%, n=${personalValid})`, range: [0, 100], gridcolor: COLORS.grid },
        yaxis: { automargin: true },
      }),
      { responsive: true, displaylogo: false }
    );
  }

  function renderTotalBudgetChart(rows) {
    const { totalValues, totalValid } = buildBudgetRates(rows);
    const minV = Math.min(...totalValues);
    const maxV = Math.max(...totalValues);

    Plotly.react(
      "totalBudgetChart",
      [
        {
          type: "bar",
          orientation: "h",
          y: TOTAL_BUDGET_ORDER,
          x: totalValues,
          marker: { color: relativeColorsWithRange(totalValues, minV, maxV) },
          text: totalValues.map((v) => `${v.toFixed(1)}%`),
          textposition: "outside",
          hovertemplate: "%{y}: %{x:.1f}%<extra></extra>",
        },
      ],
      chartLayout({
        margin: { t: 12, r: 10, b: 40, l: 110 },
        xaxis: { title: `비율(%, n=${totalValid})`, range: [0, 100], gridcolor: COLORS.grid },
        yaxis: { automargin: true },
      }),
      { responsive: true, displaylogo: false }
    );
  }

  function renderOpsChart(rows) {
    const entries = [
      ["일반 위원 참여 의사", "student_participation"],
      ["외부 인력 모집 수용", "external_staff"],
      ["운영 인건비 지급 수용", "compensation"],
      ["참여 인원 축소 수용", "reduce_participants"],
      ["작품 규모 축소 수용", "reduce_project_scale"],
      ["전시 기간 단축 수용", "shorten_period"],
    ];

    const y = [];
    const neg = [];
    const neuLeft = [];
    const neuRight = [];
    const pos = [];
    const custom = [];

    entries.forEach(([label, key]) => {
      const vals = rows.map((row) => row.ops[key]).filter((v) => Number.isFinite(v));
      const n = vals.length;
      const c1 = vals.filter((v) => v <= 2).length;
      const c2 = vals.filter((v) => v === 3).length;
      const c3 = vals.filter((v) => v >= 4).length;

      const pNeg = proportionPct(c1, n);
      const pNeu = proportionPct(c2, n);
      const pPos = proportionPct(c3, n);

      y.push(`${label} (n=${n})`);
      neg.push(-pNeg);
      neuLeft.push(-(pNeu / 2));
      neuRight.push(pNeu / 2);
      pos.push(pPos);
      custom.push([pNeg, pNeu, pPos]);
    });

    Plotly.react(
      "opsChart",
      [
        {
          type: "bar",
          orientation: "h",
          y,
          x: neuLeft,
          name: "중립(3)",
          marker: { color: "#F5E7A1" },
          customdata: custom,
          hovertemplate: "%{y}<br>중립 %{customdata[1]:.1f}%<extra></extra>",
          showlegend: true,
          legendrank: 2,
        },
        {
          type: "bar",
          orientation: "h",
          y,
          x: neg,
          name: "부정(1-2)",
          marker: { color: "#B7A8FB" },
          customdata: custom,
          hovertemplate: "%{y}<br>부정 %{customdata[0]:.1f}%<extra></extra>",
          legendrank: 1,
        },
        {
          type: "bar",
          orientation: "h",
          y,
          x: neuRight,
          marker: { color: "#F5E7A1" },
          customdata: custom,
          hovertemplate: "%{y}<br>중립 %{customdata[1]:.1f}%<extra></extra>",
          showlegend: false,
          legendrank: 2,
        },
        {
          type: "bar",
          orientation: "h",
          y,
          x: pos,
          name: "긍정(4-5)",
          marker: { color: "#FC8B57" },
          customdata: custom,
          hovertemplate: "%{y}<br>긍정 %{customdata[2]:.1f}%<extra></extra>",
          legendrank: 3,
        },
      ],
      chartLayout({
        margin: { t: 12, r: 10, b: 40, l: 180 },
        barmode: "relative",
        xaxis: {
          title: "응답 분포(%)",
          range: [-100, 100],
          gridcolor: COLORS.grid,
          tickvals: [-100, -50, 0, 50, 100],
          ticktext: ["100", "50", "0", "50", "100"],
        },
        yaxis: { automargin: true },
        legend: { orientation: "h", x: 0, y: 1.15 },
      }),
      { responsive: true, displaylogo: false }
    );
  }

  function renderRankingChart(targetId, rows, fieldName, labels) {
    const scoreMap = scoreRanking(rows, fieldName, labels);
    const sorted = labels
      .map((label) => [label, scoreMap[label]])
      .sort((a, b) => b[1] - a[1]);

    Plotly.react(
      targetId,
      [
        {
          type: "bar",
          orientation: "h",
          y: sorted.map((entry) => entry[0]).reverse(),
          x: sorted.map((entry) => entry[1]).reverse(),
          marker: { color: relativeColors(sorted.map((entry) => entry[1]).reverse()) },
          hovertemplate: "%{y}<br>가중 점수 %{x}<extra></extra>",
        },
      ],
      chartLayout({
        margin: { t: 12, r: 10, b: 40, l: 150 },
        xaxis: { title: "가중 점수(1순위=3, 2순위=2, 3순위=1)", rangemode: "tozero", gridcolor: COLORS.grid },
        yaxis: { automargin: true },
      }),
      { responsive: true, displaylogo: false }
    );
  }

  function renderInsights(rows) {
    insightList.innerHTML = "";

    if (!rows.length) {
      insightList.innerHTML = "<li>선택된 필터에 해당하는 응답이 없습니다. 필터를 조정해주세요.</li>";
      return;
    }

    const key = (text) => `<strong class="insight-key">${escapeHtml(text)}</strong>`;
    const fmt = (num, digit = 2) => (Number.isFinite(num) ? num.toFixed(digit) : "-");

    const modeStats = MODE_KEYS.map((modeKey) => {
      const values = rows.map((row) => rankToWeight(row.mode_ranking[modeKey]));
      return {
        key: modeKey,
        label: MODE_LABELS[modeKey],
        mean: average(values),
        score: values.reduce((sum, v) => sum + v, 0),
      };
    });
    const modeByLabel = Object.fromEntries(modeStats.map((entry) => [entry.label, entry]));
    const hybrid = modeByLabel["온·오프라인 병행"];
    const offline = modeByLabel["오프라인 전시"];
    const online = modeByLabel["온라인 전시"];
    const noExhibit = modeByLabel["전시 없음(졸업심사)"];

    const includedScore = (hybrid?.score || 0) + (offline?.score || 0);
    const excludedScore = (online?.score || 0) + (noExhibit?.score || 0);

    const personalCounts = Object.fromEntries(PERSONAL_BUDGET_ORDER.map((label) => [label, 0]));
    const totalCounts = Object.fromEntries(TOTAL_BUDGET_ORDER.map((label) => [label, 0]));
    let personalValid = 0;
    let totalValid = 0;

    rows.forEach((row) => {
      const p = row.personal_budget.selected || [];
      const t = row.total_budget.selected || [];
      if (p.length) personalValid += 1;
      if (t.length) totalValid += 1;
      p.forEach((label) => {
        if (personalCounts[label] !== undefined) personalCounts[label] += 1;
      });
      t.forEach((label) => {
        if (totalCounts[label] !== undefined) totalCounts[label] += 1;
      });
    });

    const personal5to20 = (personalCounts["5-10만 원"] || 0) + (personalCounts["10-20만 원"] || 0);
    const personal5to20Pct = proportionPct(personal5to20, personalValid);
    const topTotalBudget = Object.entries(totalCounts).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
    const topTotalBudgetPct = proportionPct(topTotalBudget[1], totalValid);

    const expectInfo = rankingTop(rows, "expectation_ranking", data.labels.expectations);
    const concernInfo = rankingTop(rows, "concern_ranking", data.labels.concerns);
    const topExpectation = expectInfo.top;
    const topConcern = concernInfo.top;

    const programRows = rows.reduce((acc, row) => {
      if (!acc[row.program]) acc[row.program] = [];
      acc[row.program].push(row);
      return acc;
    }, {});

    const byProgram = Object.entries(programRows).map(([program, items]) => {
      const stats = MODE_KEYS.map((modeKey) => {
        const vals = items.map((row) => rankToWeight(row.mode_ranking[modeKey]));
        return { label: MODE_LABELS[modeKey], mean: average(vals) };
      }).sort((a, b) => b.mean - a.mean);
      return { program, n: items.length, top: stats[0] };
    });

    const budgetBand = (row) => {
      const selected = row.personal_budget.selected || [];
      if (selected.includes("5-10만 원") || selected.includes("10-20만 원")) return "5~20만";
      if (selected.includes("20-30만 원") || selected.includes("40만 원-")) return "20만+";
      if (selected.includes("-5만 원") || selected.includes("부담할 수 없다")) return "0~5만";
      return "미응답";
    };

    const bandRows = rows.reduce((acc, row) => {
      const band = budgetBand(row);
      if (!acc[band]) acc[band] = [];
      acc[band].push(row);
      return acc;
    }, {});

    const modeTopByBand = Object.entries(bandRows).reduce((acc, [band, items]) => {
      const top = MODE_KEYS.map((modeKey) => {
        const vals = items.map((row) => rankToWeight(row.mode_ranking[modeKey]));
        return { label: MODE_LABELS[modeKey], mean: average(vals) };
      }).sort((a, b) => b.mean - a.mean)[0];
      acc[band] = { n: items.length, top };
      return acc;
    }, {});

    const pair = rows
      .map((row) => [row.offline_stance, row.ops.student_participation])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    const pearson = (() => {
      const x = pair.map((v) => v[0]);
      const y = pair.map((v) => v[1]);
      if (x.length < 2) return null;
      const mx = average(x);
      const my = average(y);
      const sx = Math.sqrt(x.reduce((sum, v) => sum + (v - mx) ** 2, 0));
      const sy = Math.sqrt(y.reduce((sum, v) => sum + (v - my) ** 2, 0));
      if (!sx || !sy) return null;
      const cov = x.reduce((sum, v, idx) => sum + (v - mx) * (y[idx] - my), 0);
      return cov / (sx * sy);
    })();

    const art = byProgram.find((entry) => entry.program === "예술사");
    const prof = byProgram.find((entry) => entry.program === "전문사");

    const bullets = [
      `전시 방식 선호를 오프라인 진행 여부 관점으로 재해석하면, ${key(
        `온·오프라인 병행(평균 ${fmt(hybrid?.mean)}, ${hybrid?.score || 0}점)`
      )}과 ${key(`오프라인 전시(평균 ${fmt(offline?.mean)}, ${offline?.score || 0}점)`)}는 오프라인 포함 선택지로서 합산 ${key(
        `${includedScore}점`
      )}을 보이며, 오프라인 비포함 선택지인 ${key(
        `온라인 전시(평균 ${fmt(online?.mean)}, ${online?.score || 0}점)`
      )}와 ${key(`전시 없음(평균 ${fmt(noExhibit?.mean)}, ${noExhibit?.score || 0}점)`)}의 합 ${key(
        `${excludedScore}점`
      )}보다 높다.`,
      `예산은 ${key(`개인 부담 5~20만 원(${fmt(personal5to20Pct, 1)}%)`)}에 집중되며, 총 부담 가능 금액은 ${key(
        `${escapeHtml(topTotalBudget[0])}(${fmt(topTotalBudgetPct, 1)}%)`
      )}이 최빈이다.`,
      `기대 요인의 중심은 ${
        expectInfo.validCount > 0
          ? key(`${escapeHtml(topExpectation[0])}(${topExpectation[1]}점)`)
          : key("응답 없음")
      }, 우려 요인의 중심은 ${
        concernInfo.validCount > 0 ? key(`${escapeHtml(topConcern[0])}(${topConcern[1]}점)`) : key("응답 없음")
      }이다.`,
      art && prof
        ? `과정별로는 ${key(`${escapeHtml(art.program)} ${escapeHtml(art.top.label)}(${fmt(art.top.mean)})`)}, ${key(
            `${escapeHtml(prof.program)} ${escapeHtml(prof.top.label)}(${fmt(prof.top.mean)})`
          )}가 상위다. ${
            prof.n < 5
              ? `단, ${key(`${escapeHtml(prof.program)} n=${prof.n}`)}은 방향성 수준으로만 해석한다.`
              : ""
          }`
        : `과정별 상위 선호는 ${key(
            byProgram.map((entry) => `${escapeHtml(entry.program)}:${escapeHtml(entry.top.label)}(${fmt(entry.top.mean)})`).join(" | ")
          )}로 관측된다.`,
      modeTopByBand["0~5만"] && modeTopByBand["5~20만"]
        ? `예산 구간별 선호 분화가 나타난다. ${key(
            `0~5만 원 그룹 ${escapeHtml(modeTopByBand["0~5만"].top.label)}(${fmt(modeTopByBand["0~5만"].top.mean)})`
          )}, ${key(
            `5~20만 원 그룹 ${escapeHtml(modeTopByBand["5~20만"].top.label)}(${fmt(modeTopByBand["5~20만"].top.mean)})`
          )}으로, 전시 방식 논의는 예산 논의와 분리하지 않는 것이 타당하다.`
        : `예산 구간별 표본 편차가 커 분화 해석은 제한적이다.`,
      `오프라인 전시 입장과 운영 참여 의사의 상관은 ${key(`피어슨 r=${fmt(pearson, 2)}`)}로 낮다. 오프라인 찬성과 운영 참여는 동일하지 않으므로 역할 정의/보상/업무 분배 설계를 별도로 검토해야 한다.`,
    ];

    bullets.forEach((html) => {
      const li = document.createElement("li");
      li.innerHTML = html;
      insightList.appendChild(li);
    });
  }

  function render() {
    const rows = filteredRows();
    renderModeTopChart(rows);
    renderGroupDotChart(rows);
    renderPersonalBudgetChart(rows);
    renderTotalBudgetChart(rows);
    renderOpsChart(rows);
    renderRankingChart("expectChart", rows, "expectation_ranking", data.labels.expectations);
    renderRankingChart("concernChart", rows, "concern_ranking", data.labels.concerns);
    renderInsights(rows);
  }

  resetBtn.addEventListener("click", () => {
    filterMeta.forEach((group) => {
      filters[group.key] = new Set(group.values);
    });
    renderFilters();
    render();
  });

  closeFiltersBtn.addEventListener("click", () => {
    setFiltersPanelOpen(false);
  });

  filtersBackdrop.addEventListener("click", () => {
    setFiltersPanelOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const isAdminFilterShortcut = key === "f" && event.altKey && (event.ctrlKey || event.metaKey);
    if (isAdminFilterShortcut) {
      event.preventDefault();
      toggleFiltersPanel();
      return;
    }
    if (key === "escape" && filtersPanel.classList.contains("is-open")) {
      setFiltersPanelOpen(false);
    }
  });

  renderFilters();
  setFiltersPanelOpen(false);
  render();
})();
