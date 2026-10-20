/**
 * rail — 층 레일. 사양서 §9-3 (v1.1 재설계).
 *
 * **하나의 컴포넌트, 두 밀도 모드.** 사용 가능한 높이로 자동 전환한다.
 *
 * ```
 * availH = stageH * 0.70
 * rowH   = min(20, availH / (L+1))
 * mode   = rowH >= 16 ? 'rows' : 'axis'      // 16px 미만이면 글자가 안 들어간다
 * ```
 *
 * 구 사양의 버그(행 높이 `clamp(14, 420/L, 22)`가 L=64에서 910px로 무대를 넘던 것)를
 * 고친 결과다 — **축소 상태에서는 층 수와 무관하게 항상 연속 축이 된다.**
 *
 * DOM(행 목록의 텍스트·미니바)과 SVG(연속 축의 선·눈금·스파크라인)를 섞어 쓴다.
 * three는 import하지 않는다 — 무대 왼쪽에 떠 있는 완전히 별개의 오버레이다.
 */

const ROWS_THRESHOLD_PX = 16;   // §9-3: rowH가 이 미만이면 axis 모드
const ROW_MAX_PX = 20;
const RAIL_W = 104;

export function createRail(container) {
  container.classList.add('rail');
  container.innerHTML = `
    <div class="rail__rows" hidden></div>
    <svg class="rail__axis-svg" hidden></svg>
    <div class="rail__axis-labels" hidden></div>
  `;
  const rowsEl = container.querySelector('.rail__rows');
  const svg = container.querySelector('.rail__axis-svg');
  const axisLabels = container.querySelector('.rail__axis-labels');

  let L = 0, decisionDepth = null, top1 = null, focusLayer = 0, shrunk = false;
  let mode = 'rows';
  let onPick = null;   // (layer:number) => void — 호출측(boot.js)이 채운다

  function availH() { return container.clientHeight * 0.70; }
  function computeMode() {
    if (!L) return 'rows';
    const rowH = Math.min(ROW_MAX_PX, availH() / (L + 1));
    return rowH >= ROWS_THRESHOLD_PX ? 'rows' : 'axis';
  }

  /** y(l): 레일 안에서 층 l의 세로 위치(px, 위에서부터). 두 모드가 같은 스케일을 쓴다. */
  function yOf(l) {
    const h = availH();
    const top = (container.clientHeight - h) / 2;
    return top + h * (1 - l / L);   // 위=최상단(l=L), 아래=Emb(l=0) — 3D의 Y축과 같은 방향
  }
  function layerAtY(clientY) {
    const r = container.getBoundingClientRect();
    const h = availH();
    const top = (r.top) + (container.clientHeight - h) / 2;
    const t = 1 - (clientY - top) / h;
    return Math.max(0, Math.min(L, Math.round(t * L)));
  }

  function renderRows() {
    rowsEl.hidden = false; svg.hidden = true; axisLabels.hidden = true;
    const h = availH();
    const rowH = Math.min(ROW_MAX_PX, h / (L + 1));
    const top = (container.clientHeight - h) / 2;
    rowsEl.style.top = `${top}px`;
    rowsEl.innerHTML = '';
    // 아래(Emb)부터 위(최상단)로 그린다 — 3D의 Y축 방향과 맞춘다.
    for (let l = L; l >= 0; l--) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'rail__row' + (l === focusLayer ? ' rail__row--focus' : '');
      row.style.height = `${rowH}px`;
      row.dataset.layer = String(l);
      const name = document.createElement('span');
      name.className = 'rail__name';
      name.textContent = l === 0 ? 'Emb' : `L${l - 1}`;
      row.appendChild(name);
      // Emb(l=0)는 미니바를 그리지 않는다 — top1_prob이 tied embedding 자기유사성으로
      // 항상 ≈1.0이라(로짓 렌즈의 알려진 특성, 데이터 오류 아님) 그대로 그리면 Emb 행이
      // 매번 "가장 확신에 찬 층"처럼 보인다(2026-08-27 리뷰에서 확인). 축 눈금 "Emb"는 남긴다.
      if (l > 0) {
        const bar = document.createElement('span');
        bar.className = 'rail__bar';
        const p = top1 ? top1[l] ?? 0 : 0;
        bar.style.width = `${Math.round(p * 100)}%`;
        row.appendChild(bar);
      }
      if (l === decisionDepth) {
        const d = document.createElement('span');
        d.className = 'rail__diamond'; d.textContent = '◆';
        row.appendChild(d);
      }
      row.addEventListener('click', () => onPick?.(l));
      rowsEl.appendChild(row);
    }
  }

  function renderAxis() {
    rowsEl.hidden = true; svg.hidden = false; axisLabels.hidden = false;
    const w = RAIL_W, hEl = container.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${hEl}`);
    svg.setAttribute('width', w); svg.setAttribute('height', hEl);
    const axisX = w - 14;
    const yTop = yOf(L), yBot = yOf(0);

    const parts = [];
    // 축 — 결정 깊이 위 구간만 --signal(§9-3 표). 없으면 전체 --line-strong.
    if (decisionDepth != null) {
      parts.push(`<line class="rail__axisline" x1="${axisX}" y1="${yBot}" x2="${axisX}" y2="${yOf(decisionDepth)}"/>`);
      parts.push(`<line class="rail__axisline rail__axisline--signal" x1="${axisX}" y1="${yOf(decisionDepth)}" x2="${axisX}" y2="${yTop}"/>`);
    } else {
      parts.push(`<line class="rail__axisline" x1="${axisX}" y1="${yBot}" x2="${axisX}" y2="${yTop}"/>`);
    }
    // 눈금 — 5의 배수(L≥48이면 10의 배수)
    const step = L >= 48 ? 10 : 5;
    for (let l = 0; l <= L; l += step) {
      const y = yOf(l);
      parts.push(`<line class="rail__tick" x1="${axisX - 4}" y1="${y}" x2="${axisX}" y2="${y}"/>`);
    }
    // 스파크라인 — 층별 top1_prob. 폭 20px 안에 0~1을 담는다(축 왼쪽).
    // l=1부터 그린다 — l=0(Emb)은 tied embedding 자기유사성으로 top1_prob이 항상
    // ≈1.0이라(진짜 데이터지만 로짓 렌즈 특유의 무의미한 값) 넣으면 실제 층들과
    // 같은 척도에 얹힌 인공적인 최댓값이 스파이크로 찍힌다(2026-08-27 리뷰에서 확인).
    if (top1 && top1.length === L + 1 && L >= 1) {
      const sparkW = 20;
      const pts = [];
      for (let l = 1; l <= L; l++) pts.push(`${(axisX - sparkW + top1[l] * sparkW).toFixed(1)},${yOf(l).toFixed(1)}`);
      parts.push(`<polyline class="rail__spark" points="${pts.join(' ')}"/>`);
    }
    // 결정 깊이 마커
    if (decisionDepth != null) {
      parts.push(`<circle class="rail__decision-dot" cx="${axisX}" cy="${yOf(decisionDepth)}" r="3"/>`);
    }
    // 초점 핸들 — 가로 12px × 2px, 드래그 가능(포인터 핸들러가 별도로 붙는다)
    parts.push(`<rect class="rail__handle" x="${axisX - 6}" y="${(yOf(focusLayer) - 1).toFixed(1)}" width="12" height="2"/>`);
    svg.innerHTML = parts.join('');

    // 라벨 — Emb·최상단·5~6개 눈금·초점·결정 깊이만. 축소 상태는 Emb·최상단·초점 3개.
    const labelSet = new Map();   // layer -> text (중복 시 뒤가 이긴다 — 초점/결정이 우선하도록 나중에 덮어씀)
    if (!shrunk) {
      labelSet.set(0, 'Emb');
      labelSet.set(L, `L${L - 1}`);
      // ⚠️ 2026-08-27 리뷰: 예전엔 라벨을 "6개를 인덱스로 균등 분배"해서 골랐는데,
      // 그 위치는 위 눈금(<line class="rail__tick">, `step`의 배수)과 다른 격자였다.
      // L=64에서 라벨이 0·13·26·38·51·64에 찍히는데 눈금은 0·10·20·…·60이라, 13·26·38·51
      // 라벨이 어느 눈금과도 안 맞아 "축에서 붕 뜬" 것처럼 보였다 — 사용자가 32B 축
      // 모드에서 본 것이 이것이다(단발성 "Emb 라벨" 문제가 아니라 격자 불일치였다).
      // 라벨은 반드시 눈금과 같은 `step`의 배수에서만 고른다.
      const tickCount = Math.floor(L / step) + 1;
      const labelStep = Math.max(step, step * Math.ceil(tickCount / 6));
      for (let l = 0; l <= L; l += labelStep) {
        if (!labelSet.has(l)) labelSet.set(l, l === 0 ? 'Emb' : `L${l - 1}`);
      }
    } else {
      labelSet.set(0, 'Emb');
      labelSet.set(L, `L${L - 1}`);
    }
    // ⚠️ 순서가 중요하다 — focusLayer와 decisionDepth가 같은 층이면(초기 포커스가
    // 보통 결정 깊이라 흔하다) 나중에 set()한 쪽이 텍스트를 덮어쓴다. 결정 마커(◆)가
    // 더 중요한 정보이므로 **반드시 나중에** 써서 살아남게 한다. `--focus` 강조 스타일은
    // 텍스트가 아니라 `l === focusLayer` 검사로 따로 매겨지므로 순서와 무관하게 유지된다.
    labelSet.set(focusLayer, focusLayer === 0 ? 'Emb' : `L${focusLayer - 1}`);
    if (decisionDepth != null) labelSet.set(decisionDepth, `◆L${decisionDepth === 0 ? 'Emb' : decisionDepth - 1}`);

    axisLabels.innerHTML = '';
    for (const [l, text] of labelSet) {
      const el = document.createElement('span');
      el.className = 'rail__axislabel' + (l === focusLayer ? ' rail__axislabel--focus' : '');
      el.textContent = text;
      el.style.top = `${yOf(l).toFixed(1)}px`;
      axisLabels.appendChild(el);
    }
  }

  function render() {
    const next = computeMode();
    mode = next;   // 크로스페이드 없이 즉시 교체(§9-3) — 스크롤 중 깜빡임 방지
    if (mode === 'rows') renderRows(); else renderAxis();
  }

  /* 축 모드: 클릭으로 점프, 핸들 드래그로 연속 이동 */
  let dragging = false;
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    onPick?.(layerAtY(e.clientY));
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => { if (dragging) onPick?.(layerAtY(e.clientY)); });
  svg.addEventListener('pointerup', (e) => { dragging = false; svg.releasePointerCapture(e.pointerId); });

  const ro = new ResizeObserver(render);
  ro.observe(container);

  return {
    /** @param {number} n_layers @param {number|null} decision @param {number[]|null} top1_prob */
    setLayers(n_layers, decision, top1_prob) {
      L = n_layers; decisionDepth = decision; top1 = top1_prob;
      render();
    },
    setFocus(l) { focusLayer = l; render(); },
    setShrunk(v) { shrunk = !!v; render(); },
    set onPick(fn) { onPick = fn; },
    dispose() { ro.disconnect(); },
  };
}
