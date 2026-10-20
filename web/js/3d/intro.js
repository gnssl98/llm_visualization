/**
 * intro — 등장 시퀀스. 사양서 §8-1 "데이터는 도착한다". 총 길이 약 1.6초.
 *
 * ```
 * 0        빈 격자 자전 정지, 카메라 3/4 프리셋(--t-3)
 * 0–900    노드가 아래층부터 순차 등장. stagger = min(24, 900/L)ms. 알파 0→목표, Y −0.3→0
 * 300–1200 세로 궤적이 아래에서 위로 그려짐
 * 700–1100 초점 층 평면 페이드 인
 * 900–1400 결정 깊이 선이 그려지고, 그 위 마지막 토큰이 --signal로 굳는다 (클라이맥스)
 * ```
 *
 * **스코프**: attention 엣지의 "좌→우 순차 드로잉"과 확률 HUD 성장은 뺐다. 엣지는
 * T3-2 지연 로드로 도착 시점이 이 1.6초 창과 거의 안 맞고(비동기, 대부분 창 밖에서 옴),
 * HUD(§9-5, R3-35)는 아직 만들지 않았다 — 없는 위젯을 애니메이션할 수 없다.
 *
 * **재생 주체는 main.js다.** 이 파일은 "진행률 t(0~1) → 시각 상태"로 바꾸는 순수 계산과
 * 재생 루프만 담당하고, three 객체(노드 InstancedMesh 등)는 호출측이 넘겨준다.
 *
 * §8-1 마지막 줄: `prefers-reduced-motion`에서는 **전 구간 생략**하고 최종 프레임을
 * 즉시 렌더한다 — `--t-*`를 0으로 만드는 것만으로는 rAF 루프가 안 멈추므로 JS에서
 * 명시적으로 분기한다(S-06). `reducedMotion()`이 그 분기다.
 */

const TOTAL_MS = 1600;
const NODE_END = 900;
const TRAIL_START = 300, TRAIL_END = 1200;
const PLANE_START = 700, PLANE_END = 1100;
const DECISION_START = 900, DECISION_END = 1400;

export function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** [0,1]로 클램프한 선형 진행률. end < start면(구간 없음) 1(완료)로 본다. */
function ease(t, start, end) {
  if (end <= start) return 1;
  return Math.max(0, Math.min(1, (t - start) / (end - start)));
}

/**
 * @param {object} nodes buildNodes() 결과
 * @param {object|null} trails buildTrails() 결과 (null 가능 — 층 1개뿐인 분석)
 * @param {object|null} decor buildDecor() 결과
 * @param {object} c makeCoords() 결과
 * @param {object} state 최종 상태(§7-1) — 애니메이션이 수렴할 목표
 * @param {{base,focus,adjacent,selected,decided}} nodeColors `nodes.resolveNodeColors()` 그대로
 * @param {{r,g,b}} trailBaseColor `trails.resolveTrailBaseColor()` 그대로
 * @param {{r,g,b}} paperColor `cssColor('--paper')` — 노드가 "어디서" 나타나는지의 시작색.
 *        검정(0,0,0)에서 시작하면 등장이 아니라 그을리며 나타나는 것처럼 보인다.
 *
 * **rAF·렌더는 여기서 다루지 않는다.** 이 함수는 "지금이 몇 ms째인지 → 씬 속성을
 * 어떻게 바꿀지"만 계산하는 순수 스테퍼를 돌려준다(labels.js·annotate.js와 같은 원칙 —
 * three 객체는 건드리지만 rAF 루프 소유권은 호출측인 main.js에 둔다). 그래야 on-demand
 * 렌더 루프(§4-6)와 애니메이션 전용 루프가 서로의 존재를 몰라도 되고, "두 rAF 체인이
 * 서로를 한 프레임씩 뒤쫓는" 꼬임이 생기지 않는다.
 */
export function createIntro({ nodes, trails, decor, c, state, nodeColors, trailBaseColor, paperColor }) {
  const { rows, T, layerOf } = nodes;
  const colors = { ...nodeColors, trailBase: trailBaseColor };
  const stagger = Math.min(24, NODE_END / c.L || NODE_END);
  const nodeDelayFor = (row) => layerOf(row) * stagger;   // 아래층(Emb)이 delay=0, 먼저 나타난다
  const NODE_DUR = 260;                                     // 개별 노드 알파·Y 전환 길이

  const focusRow = new Map();
  for (let r = 0; r < rows; r++) focusRow.set(layerOf(r), r);
  const lastToken = T - 1;

  // 최종 색(현재 state 기준)을 한 번만 계산해 매 프레임 재사용한다.
  const finalColor = (row, i) => {
    const l = layerOf(row);
    const dl = Math.abs(l - state.focusLayer);
    let base = dl === 0 ? colors.focus : dl === 1 ? colors.adjacent : colors.base;
    if (state.selectedToken === i) base = colors.selected;
    if (state.decisionDepth != null && l >= state.decisionDepth && i === lastToken) base = colors.decided;
    return base;
  };

  const t0 = performance.now();

  /** @returns {boolean} true면 아직 진행 중(다음 프레임도 불러야 함), false면 끝났다. */
  function step(now) {
    const t = now - t0;

    // ── 노드: 층별 stagger로 알파 0→1, Y −0.3·DY→0 ──
    const col = nodes.mesh.instanceColor;
    const posAttr = nodes.mesh.instanceMatrix;
    for (let r = 0; r < rows; r++) {
      const delay = nodeDelayFor(r);
      const p = ease(t, delay, delay + NODE_DUR);
      for (let i = 0; i < T; i++) {
        const fc = finalColor(r, i);
        const k = r * T + i;
        // 알파 채널이 없으니(InstancedMesh 정점색) 배경색에서 목표색으로 lerp해
        // "옅게 있다가 짙어짐"을 흉내 낸다. 검정에서 시작하면 그을리듯 나타나 보인다.
        col.setXYZ(k, paperColor.r + (fc.r - paperColor.r) * p,
                      paperColor.g + (fc.g - paperColor.g) * p,
                      paperColor.b + (fc.b - paperColor.b) * p);
        const idx = k * 16 + 13;   // Matrix4 열 우선 배열의 Y 평행이동 성분(요소 13)
        const yFinal = c.y(layerOf(r));
        posAttr.array[idx] = yFinal - 0.3 * c.DY * (1 - p);
      }
    }
    col.needsUpdate = true;
    posAttr.needsUpdate = true;

    // ── 궤적: 아래(Emb)에서 위로 진행률만큼만 보인다 ──
    if (trails) {
      const trailP = ease(t, TRAIL_START, TRAIL_END);
      const tcol = trails.mesh.geometry.attributes.color;
      for (let i = 0; i < T; i++) {
        const [s, e] = trails.rangeOf(i);
        const revealY = trailP * rows;   // 행 단위 진행
        for (let v = s; v < e; v++) {
          const ring = Math.floor((v - s) / trails.ringSize);
          const rowFrac = ring / trails.subdiv;   // 0(Emb)~rows-1
          const show = rowFrac <= revealY;
          // show=0일 때 (0,0,0)을 넣으면 "안 보임"이 아니라 **검은 선**이 그려진다
          // (궤적은 불투명 메시라 색 자체가 화면에 그대로 나간다). 배경색을 넣어야
          // 진짜로 안 보인다 — 위 노드 페이드와 같은 이유의 같은 실수였다.
          const base = show ? colors.trailBase : paperColor;
          tcol.setXYZ(v, base.r, base.g, base.b);
        }
      }
      tcol.needsUpdate = true;
    }

    // ── 초점 층 평면: 페이드 인 ──
    if (decor) {
      const planeP = ease(t, PLANE_START, PLANE_END);
      decor.setPlaneOpacity(planeP);
      // ── 결정 깊이 선: 900~1400 구간에 나타난다 ──
      const decP = ease(t, DECISION_START, DECISION_END);
      decor.setDecisionOpacity(decP);
    }

    if (t >= TOTAL_MS) {
      // 최종 프레임을 "진짜" 최종 상태로 한 번 더 덮어써 애니메이션 근사 오차를 지운다.
      if (decor) { decor.setPlaneOpacity(1); decor.setDecisionOpacity(state.decisionDepth != null ? 1 : 0); }
      return false;
    }
    return true;
  }

  return { step };
}
