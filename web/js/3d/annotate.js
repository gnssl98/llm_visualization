/**
 * annotate — 3D 안 주석 + SVG 리더선. 사양서 §6-4.
 *
 * "상시 1개(결정 깊이) + 상태 연동 1개(호버/선택). 동시에 3개를 넘기지 않는다."
 * 여기서는 최대 2개만 쓴다(결정 깊이 + 상태연동 하나) — 셋째 슬롯(§6-4의 "3개")은
 * 사양서가 여유로 둔 상한이지 지금 화면이 채우는 개수가 아니다.
 *
 * three는 import하지 않는다 — 호출측이 이미 투영한 화면 좌표만 받는다(labels.js와 동형).
 * `window.t`(i18n.js)를 그대로 쓴다 — 문자열을 여기서 새로 짓지 않는다.
 */

const MARGIN = 16;     // px, 무대 가장자리에서 말풍선까지의 여백
const V_PAD = 24;       // px, 위아래 가장자리에 붙지 않도록 두는 최소 여백
const MIN_GAP = 44;     // px, 두 주석이 세로로 이보다 가까우면 겹친 것으로 본다

/**
 * @param {HTMLElement} container `.annotations` — 텍스트 두 줄짜리 말풍선을 담는 곳
 * @param {SVGSVGElement} svg 리더선 전용, `.stage` 크기와 같은 절대 위치
 */
export function createAnnotationLayer(container, svg) {
  const els = { decision: null, hover: null };
  const lines = { decision: null, hover: null };
  const placed = { decision: null, hover: null };   // 마지막으로 놓인 {y, side} — 충돌 회피용

  function makeBox(key) {
    const el = document.createElement('div');
    el.className = 'annot';
    container.appendChild(el);
    els[key] = el;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('class', 'annot__leader');
    svg.appendChild(line);
    lines[key] = line;
    return el;
  }

  /**
   * §6-4 자리 배치. **점 구름 안이 아니라 무대 바깥 가장자리에 건다.**
   *
   * ⚠️ 2026-08-27 리뷰: 예전엔 데이터 지점에서 12px만 띄웠다 — 그 정도로는 씬이
   *    조밀할 때(토큰이 많을 때) 여전히 점 구름 안쪽이거나 토큰 라벨과 겹쳤다.
   *    이제 말풍선은 항상 **무대 가장자리(±MARGIN)** 에 고정하고, 리더선이 그
   *    가장자리부터 실제 데이터 지점까지 전체 거리를 그어 "가리키는" 관계를 보여준다.
   *
   * `key === 'decision'`은 §6-4 원문대로 **항상 오른쪽**에 건다(상시 슬롯이라
   * 자리가 매 프레임 옮겨 다니면 오히려 산만하다). `hover`는 상태 연동이라
   * 데이터 지점이 있는 쪽 가장자리를 따라간다.
   */
  function sideFor(key, sx, stageW) {
    if (key === 'decision') return 'right';
    return sx < stageW / 2 ? 'right' : 'left';
  }

  /**
   * @param {'decision'|'hover'} key
   * @param {{sx:number, sy:number, text:string}|null} data null이면 지운다.
   */
  function set(key, data) {
    if (!data || !data.text) {
      if (els[key]) { els[key].classList.add('hidden'); }
      if (lines[key]) { lines[key].setAttribute('points', ''); }
      placed[key] = null;
      return;
    }
    const el = els[key] || makeBox(key);
    const line = lines[key];
    if (el.textContent !== data.text) el.textContent = data.text;
    el.classList.remove('hidden');

    const stageW = container.clientWidth || window.innerWidth;
    const stageH = container.clientHeight || window.innerHeight;
    const side = sideFor(key, data.sx, stageW);

    // 세로 위치는 데이터 지점을 따라가되, 위아래 가장자리와 다른 주석과 부딪히지 않게 조정.
    let y = Math.min(Math.max(data.sy, V_PAD), stageH - V_PAD);
    const other = key === 'decision' ? placed.hover : placed.decision;
    if (other && other.side === side && Math.abs(other.y - y) < MIN_GAP) {
      // 두 주석이 같은 가장자리에서 부딪히면 결정 주석(상시 1개)을 우선하고
      // 상태 연동 주석을 그만큼 밀어낸다 — §6-4가 상시 1개를 기준선으로 두므로.
      y = key === 'decision' ? y : (other.y < stageH / 2 ? other.y + MIN_GAP : other.y - MIN_GAP);
      y = Math.min(Math.max(y, V_PAD), stageH - V_PAD);
    }
    placed[key] = { y, side };

    const edgeX = side === 'right' ? stageW - MARGIN : MARGIN;

    // 리더선: 데이터 지점 → (가장자리 쪽으로) 중간 꺾임 1회 → 말풍선 부착점.
    const midX = data.sx + (side === 'right' ? 24 : -24);
    line.setAttribute('points', `${data.sx},${data.sy} ${midX},${y} ${edgeX},${y}`);

    // 말풍선은 부착점에서 **무대 안쪽으로** 자란다. `.annotations`가 overflow:hidden이라
    // 반대로 두면(가장자리에서 바깥으로) 텍스트가 잘려 글자 한두 개만 보인다 —
    // 2026-08-27 실측 스크린샷에서 실제로 "답" 한 글자만 남고 나머지가 잘려 나갔다.
    const boxX = side === 'right' ? edgeX - 4 - el.offsetWidth : edgeX + 4;
    el.style.transform = `translate3d(${boxX.toFixed(1)}px, ${(y - 8).toFixed(1)}px, 0)`;
  }

  function dispose() {
    for (const k of Object.keys(els)) { if (els[k]) els[k].remove(); if (lines[k]) lines[k].remove(); }
  }

  return { set, dispose };
}

/**
 * 결정 깊이 문장. §3-6 케이스 B(결정 깊이 없음)를 그대로 따른다 —
 * 그 경우 기준선이 없듯, 문장도 "L{d}에서" 대신 "마지막 층에서야"로 바뀐다.
 */
export function decisionText(decisionDepth) {
  return decisionDepth == null
    ? window.t('d3.decision.unreached')
    : window.t('d3.decision.reached', { d: decisionDepth });
}

/** 엣지를 직접 호버했을 때 — 그 엣지 하나의 가중치를 그대로 보여준다(§7-1 edge-hover). */
export function edgeText(tokens, edge) {
  const label = (i) => tokens[i]?.text ?? String(i);
  return window.t('d3.edge.weight', { q: label(edge.q), k: label(edge.k), w: edge.w.toFixed(2) });
}

/**
 * 토큰이 포커스됐을 때(hover 또는 선택) — **그 토큰이 이 층에서 어디를 보는가**(§7-1 token-focus).
 * sink 규칙은 [2D스펙] §5-2-1과 같은 판단 축을 쓴다: 서버가 이미 sink query를 표시해
 * 내려주므로(`attention.sink_queries`, B-05) 여기서 다시 계산하지 않는다.
 *
 * @param {Array<{text:string}>} tokens
 * @param {{edges:Array<{q,k,w,sink?}>, sink_queries:number[]}|null} attn 현재 초점 층의 attention 응답.
 *        아직 안 왔거나(Embedding 층 등) 이 토큰이 attention 대상이 아니면 null을 돌려준다.
 * @param {number} q 포커스된 토큰(query) 인덱스
 */
export function tokenAttentionText(tokens, attn, q) {
  if (!attn) return null;
  const label = (i) => tokens[i]?.text ?? String(i);
  const cand = attn.edges.filter((e) => e.q === q && !e.sink);
  if (!cand.length) return null;
  cand.sort((a, b) => b.w - a.w);
  const top = cand[0];
  const isSink = attn.sink_queries?.includes(q);
  const key = isSink ? 'd3.annot.sink' : 'd3.annot.attends';
  return window.t(key, { q: label(q), k: label(top.k), w: top.w.toFixed(2) });
}
