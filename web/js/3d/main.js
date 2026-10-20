/**
 * main — 부트스트랩 · 렌더 루프 · 카메라 · 인터랙션. 사양서 §4-2, §4-6, §5, §6, §7.
 *
 * **상시 렌더 금지(§4-6).** 카메라·선택·애니메이션이 변할 때만 프레임을 그린다.
 * 정지 상태에서 rAF가 계속 돌면 반려다(§15-3) — 발표용 노트북 배터리와 팬 소음이
 * 그대로 청중에게 간다. 라벨·주석 DOM 갱신도 이 루프에 얹는다 — WebGL 프레임이
 * 그려질 때만 갱신되므로 정지 중에는 이쪽도 공짜다.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeCoords, normalizePC1, sceneBox, fitDistance, axisWarnings } from './coords.js';
import { cssColor, cssMs, assertTokens, invalidateTheme } from './theme.js';
import { buildNodes, paintNodes, resolveNodeColors, SEGMENTS_LOW } from './nodes.js';
import { buildTrails, paintTrails, resolveTrailBaseColor, SUBDIV_LOW } from './trails.js';
import { buildDecor } from './decor.js';
import { buildEdges } from './edges.js';
import { createLabelLayer, project } from './labels.js';
import { createAnnotationLayer, decisionText, edgeText, tokenAttentionText } from './annotate.js';
import { pickNode, pickEdge } from './picking.js';
import { createIntro, reducedMotion } from './intro.js';
import { createPerfMonitor } from './perf.js';

const FOV = 30;      // §5-1. 넓은 화각은 원근 왜곡이 커져 "같은 크기 노드"가 다르게 보인다

/** §5-2 프리셋. distance는 fitDistance 결과에 배율을 곱한다. */
export const PRESETS = {
  front:   { az: 0,             el: 0,               mul: 1.00 },
  side:    { az: Math.PI / 2,   el: 0,               mul: 1.05 },
  top:     { az: 0.489,         el: 1.082,           mul: 1.20 },   // 28° / 62°
  threeQ:  { az: 0.559,         el: 0.314,           mul: 1.00 },   // 32° / 18° — 초기
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} stageEl
 * @param {{attentionUrl?: (layer:number)=>string}} [opts]
 *   attentionUrl이 있으면 초점 층이 바뀔 때 `/api/attention?layer=L`(T3-2)을
 *   지연 로드하고 인접 ±2층을 프리페치한다(§5-2). 없으면 엣지를 그리지 않는다 —
 *   좌표·노드만 검증하던 단계 3 테스트가 이 옵션 없이도 그대로 돌아야 한다.
 */
export function createStage(canvas, stageEl, opts = {}) {
  assertTokens();

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.NoToneMapping;   // 도표다. 톤매핑은 값을 왜곡한다
  renderer.setClearColor(cssColor('--paper'), 1);

  const scene = new THREE.Scene();
  scene.background = cssColor('--paper');
  // 조명 없음. Fog도 쓰지 않는다 — 투명도와 안개가 겹치면 결과가 예측되지 않는다(§4-2).

  // §6 DOM 오버레이. index.html이 이미 만들어 둔 컨테이너를 찾아 쓴다 —
  // main.js가 매번 새로 만들면 재분석마다 중복 생성될 위험이 있다.
  const labelLayer = createLabelLayer(stageEl.querySelector('.labels'));
  const annotLayer = createAnnotationLayer(stageEl.querySelector('.annotations'), stageEl.querySelector('.leaders'));
  const bubbleEl = stageEl.querySelector('.bubble');
  const raycaster = new THREE.Raycaster();

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // 뒤집힘 방지. 극점을 넘으면 "위"가 바뀌어 층 순서가 거꾸로 읽힌다.
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI - 0.15;
  // ⚠️ enableZoom은 **켜둔다.** 이 플래그는 dolly 경로 전체를 게이트하므로 끄면
  //    휠뿐 아니라 우클릭 드래그·두 손가락 핀치 줌까지 함께 죽는다(§5-3 v1.1 정정).
  controls.enableZoom = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.DOLLY,
  };

  // 휠은 언제나 페이지 스크롤이다(§5-3). 플래그가 아니라 **이벤트를 가로채서** 막는다.
  // 캔버스의 조상에 캡처 단계로 단다 — 같은 요소에 달면 등록 순서에 따라 OrbitControls가
  // 먼저 받을 수 있다. preventDefault는 하지 않는다(그래야 페이지가 정상 스크롤된다).
  const onWheel = (e) => {
    if (e.target === canvas || canvas.contains(e.target)) e.stopPropagation();
  };
  stageEl.addEventListener('wheel', onWheel, { capture: true, passive: true });

  /* ── on-demand 렌더 (§4-6) ─────────────────────────── */
  let needsRender = true;
  let rafId = 0;
  let disposed = false;

  /**
   * ⚠️ 예약은 **반드시 이 함수를 통한다.** `rafId`를 직접 대입하면 안 된다.
   *
   * `controls.update()`는 카메라를 움직이면 그 자리에서 `change`를 쏘고, 그 핸들러가
   * `requestRender()`로 rAF를 하나 잡는다. 그 뒤 `tick()`이 `rafId = requestAnimationFrame()`
   * 로 덮어쓰면 **예약이 둘 남고 추적을 잃는다.** 각 프레임이 다시 둘을 낳아 매 프레임
   * 2배로 늘어난다 — 실측에서 정지 2초에 2,461프레임이 나왔다(상시 렌더 = §15-3 반려).
   * `if (!rafId)` 게이트가 그것을 막는다.
   */
  function schedule() {
    if (!disposed && !rafId) rafId = requestAnimationFrame(tick);
  }

  function requestRender() {
    if (disposed) return;
    needsRender = true;
    schedule();
  }

  function tick() {
    rafId = 0;
    // damping이 켜져 있으면 update()가 카메라를 계속 조금씩 움직인다.
    // 그 변화가 끝날 때까지는 다음 프레임을 예약해야 하므로 반환값을 본다.
    const moved = controls.update();
    if (moved || needsRender) {
      needsRender = false;
      renderer.render(scene, camera);
      frame.count++;
      // renderer.info.render는 **매 프레임 초기화된다.** 렌더 밖에서 읽으면 0이 나온다.
      // 상태 줄이 실제로 0을 표시하는 버그가 있었다 — 여기서 붙잡아 둔다.
      frame.calls = renderer.info.render.calls;
      refreshOverlays();       // §6 — WebGL과 같은 cadence로. 정지 중엔 이것도 안 돈다
      // §4-6·R3-43: 실제로 렌더된 프레임만 fps 창에 넣는다. 정지 구간(on-demand 미렌더)을
      // 섞으면 "프레임 사이 시간"이 아니라 "유휴 시간"을 재게 되어 가짜 저사양 판정이 나온다.
      const degrade = perfMon.frame(performance.now());
      if (degrade) applyDegradation(degrade);
      if (moved) schedule();   // 관성이 남아 있다. 이미 예약됐으면 no-op
    }
  }
  controls.addEventListener('change', requestRender);

  const frame = { count: 0, calls: 0 };

  /* ── 크기 ──────────────────────────────────────────── */
  let box = null;
  let lastSize = { w: 1, h: 1 };
  let shrunk = false;    // §5-4·§6-2 — 무대 축소 상태에서 라벨 상한 24→10
  function resize() {
    const w = canvas.clientWidth || stageEl.clientWidth || 1;
    const h = canvas.clientHeight || stageEl.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // ⚠️ LineMaterial은 화면 픽셀 굵기를 계산하려고 해상도를 알아야 한다.
    //    여기서 갱신하지 않으면 창 크기에 따라 굵기가 틀어진다(§15-3 체크 항목).
    //    단계 4의 attention 엣지도 같은 재질을 쓰므로 여기에 함께 걸린다.
    if (decor) decor.setResolution(w, h);
    if (edges) edges.setResolution(w, h);
    lastSize = { w, h };
    requestRender();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stageEl);

  /* ── 카메라 배치 ───────────────────────────────────── */
  let currentPresetName = 'threeQ';
  let userAdjusted = false;   // 사용자가 직접 돌린 뒤로는 프로그램이 카메라를 밀지 않는다(§5-4)
  controls.addEventListener('start', () => { userAdjusted = true; });

  function applyPreset(name) {
    const p = PRESETS[name] || PRESETS.threeQ;
    if (!box) return;
    currentPresetName = name;
    userAdjusted = false;   // 명시적 프리셋 호출은 "프로그램이 놓은 자리"로 되돌리는 것
    // 시선 방향을 먼저 정하고 그 방향으로 상자를 재야 한다 —
    // 측면·조감에서는 카메라 쪽 깊이가 Z가 아니다(측면은 X, 조감은 Y).
    const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - p.el, p.az);
    const d = fitDistance(box, FOV, camera.aspect, dir) * p.mul;
    // 구면 좌표로 놓는다. 직교 좌표를 lerp하면 전환 중 카메라가 씬을 관통한다(§5-2).
    const s = new THREE.Spherical(d, Math.PI / 2 - p.el, p.az);
    camera.position.setFromSpherical(s).add(new THREE.Vector3(box.center.x, box.center.y, box.center.z));
    controls.target.set(box.center.x, box.center.y, box.center.z);
    controls.update();
    requestRender();
  }

  /**
   * §5-4 sticky shrink 전용. 무대 종횡비가 바뀌면 같은 프리셋이라도 거리 재계산이
   * 필요하다. **사용자가 카메라를 직접 만졌으면 아무것도 하지 않는다** — 남의 손을
   * 밀치는 UI가 된다는 게 사양서의 표현이다.
   */
  function refit() {
    if (!userAdjusted) applyPreset(currentPresetName);
  }

  /* ── 데이터 반영 ───────────────────────────────────── */
  let nodes = null;
  let trails = null;
  let decor = null;
  let edges = null;
  let norm = null;               // hidden_proj_3d 정규화 결과 — 엣지가 노드 z를 읽을 때 쓴다
  let coordsRef = null;          // 최근 makeCoords() 결과 — attention 응답 도착 시 필요
  let layerToRow = new Map();    // 층 번호(hidden_proj 행) → pc1n 행 인덱스 (서브샘플 대응)
  let attnLayerCount = 0;        // attention 배열 길이 = 실제 transformer 층 수 (n_layers)
  let gen = 0;                   // setData 세대. 늦게 도착한 attention 응답을 버리는 용도
  const attnCache = new Map();   // attnIndex(0..attnLayerCount-1) -> Promise<response>
  let tokensData = [];           // data.tokens — 라벨·주석 문장이 텍스트를 읽어 오는 곳
  let currentAttnResp = null;    // applyEdges가 채움. tokenAttentionText가 q의 상위 k를 찾을 때 쓴다
  let state = {
    focusLayer: 0, selectedToken: null,
    locked: false,        // true = node-select(클릭으로 고정, 말풍선 표시). false = hover/키보드로만 이동
    hoverEdge: null,      // {q,k,w,sink} — edge-hover 상태(§7-1)
    decisionDepth: null, surprisal: null,
  };

  /**
   * hidden_proj 행 번호(§2-1, 0=Embedding)를 attention 배열 인덱스로 바꾼다.
   *
   * ⚠️ 임베딩 자체는 attention을 계산하지 않는다 — attention은 트랜스포머 블록 안에서
   * 일어나고, 블록 i(0-indexed)의 attention이 만드는 결과가 hidden_proj 행 i+1이다.
   * 그래서 focusLayer(행 번호) r에 대응하는 attention 인덱스는 **r − 1**이다.
   * 이 관계는 백엔드(`panels.py`)가 초기 응답의 초점 층을 고를 때 쓰는 것과 같다
   * (`focus = decision_depth - 1`) — 프론트가 새로 정의하는 규칙이 아니라 그걸 따르는 것이다.
   */
  function attnIndexFor(focusLayer) {
    const idx = focusLayer - 1;
    return idx >= 0 && idx < attnLayerCount ? idx : null;
  }

  /**
   * 분석 응답을 씬에 싣는다.
   * @param {object} data /api/analyze 응답
   */
  function setData(data) {
    clearScene();

    const L = data.model.n_layers;
    const T = data.model.seq;
    const c = makeCoords(L, T);
    coordsRef = c;
    norm = normalizePC1(data.hidden_proj_3d, data.subsample);  // 바깥 클로저 변수에 대입

    nodes = buildNodes(c, norm.pc1n, norm.layerOf);
    scene.add(nodes.mesh);
    trails = buildTrails(c, norm.pc1n, norm.layerOf);
    if (trails) scene.add(trails.mesh);
    decor = buildDecor(c, lastSize);
    scene.add(decor.group);

    layerToRow = new Map();
    for (let r = 0; r < norm.rows; r++) layerToRow.set(norm.layerOf(r), r);
    attnLayerCount = data.model.n_layers;
    attnCache.clear();
    tokensData = data.tokens || [];
    currentAttnResp = null;
    gen++;

    box = sceneBox(c);
    state = {
      // 초점은 결정 깊이에서 시작한다 — 이 화면이 말하려는 것이 거기 있다.
      focusLayer: data.logit_lens?.decision_depth ?? L,
      selectedToken: null, locked: false, hoverEdge: null,
      // 결정 깊이가 마지막 층이면 "확정되지 않았다"는 뜻이라 선을 그리지 않는다(§3-6 케이스 B).
      decisionDepth: data.logit_lens?.reliable ? data.logit_lens.decision_depth : null,
      surprisal: normalizeSurprisal(data.surprisal),
    };
    applyPreset('threeQ');   // §8-1 t=0: 카메라가 먼저 3/4로 붙는다
    loadAttention(state.focusLayer);   // state가 정해진 뒤에 — attnIndexFor가 그걸 읽는다
    if (api.onStateChange) api.onStateChange(state);

    // §8-1 등장 시퀀스. reduced-motion이면 --t-*를 0으로 만드는 것만으로는 rAF가 안
    // 멈추므로 JS에서 명시적으로 분기한다(S-06) — 여기서 그냥 최종 프레임을 바로 그린다.
    if (reducedMotion()) {
      repaint();
      requestRender();
    } else {
      // ⚠️ decor의 평면·결정선은 `visible`이 기본 false다. `setFocus`/`setDecision`이
      // 위치·표시 여부를 정하는데, 그건 정식 repaint()가 (의도적으로) intro 종료 후에나
      // 불린다. intro.js는 **opacity만** 애니메이션하므로, 이걸 먼저 안 부르면
      // "보이지 않는 물체의 투명도"만 바꾸는 셈이 된다 — 실측(material.opacity는 정상
      // 변화하는데 object.visible=false라 화면엔 아무것도 안 그려짐)으로 잡은 버그다.
      if (decor) {
        decor.setFocus(state.focusLayer);
        decor.setDecision(state.decisionDepth);
        decor.setPlaneOpacity(0);
        decor.setDecisionOpacity(0);
      }
      const intro = createIntro({
        nodes, trails, decor, c, state,
        nodeColors: resolveNodeColors(), trailBaseColor: resolveTrailBaseColor(),
        paperColor: cssColor('--paper'),
      });
      const introGen = gen;   // 재생 도중 재분석되면 낡은 루프를 멈춘다
      const loop = (now) => {
        if (introGen !== gen) return;               // 새 분석이 이미 시작됨 — 이 루프는 폐기
        const more = intro.step(now);
        renderer.render(scene, camera);              // on-demand를 우회 — 애니메이션 중엔 매 프레임 그린다
        frame.count++;
        frame.calls = renderer.info.render.calls;
        refreshOverlays();
        if (more) requestAnimationFrame(loop);
        else { repaint(); requestRender(); }          // 종료 — 정식 paint로 최종 상태 확정 후 on-demand 복귀
      };
      requestAnimationFrame(loop);
    }
    return {
      coords: c, norm,
      warnings: axisWarnings(norm),      // 캡션이 그대로 띄운다(§2-3-2)
      subsample: data.subsample,
    };
  }

  function setState(patch) {
    const prevSel = state.selectedToken;
    const prevLayer = state.focusLayer;
    state = { ...state, ...patch };
    if (!nodes) return;
    // 굵은 강조 궤적은 선택이 **바뀐 경우에만** 다시 만든다.
    // 층 슬라이더를 끌 때마다 만들면 드래그가 무거워진다.
    if (trails && state.selectedToken !== prevSel) trails.setHighlight(state.selectedToken, scene);
    if (state.focusLayer !== prevLayer) loadAttention(state.focusLayer);
    repaint();
    requestRender();
    if (api.onStateChange) api.onStateChange(state);   // §7-3 — 아래 밴드 제목 연동
  }

  /**
   * T3-2 지연 로드. focusLayer가 attention을 갖지 않으면(Embedding 행) 엣지를 비운다.
   * 캐시에 있으면 즉시 반영 — 재추론이 아니라 조회이므로 왕복이 없다.
   * 없으면 요청하고 응답이 오면 반영하되, **그사이 다른 층으로 옮겼거나 다른 분석으로
   * 넘어갔으면 버린다**(늦게 도착한 응답이 화면을 덮어쓰지 않게).
   */
  function loadAttention(focusLayer) {
    if (!opts.attentionUrl) return;
    const idx = attnIndexFor(focusLayer);
    if (idx == null) { clearEdges(); if (api.onAttention) api.onAttention(null); return; }

    const myGen = gen;
    fetchAttn(idx).then((resp) => {
      if (myGen !== gen || attnIndexFor(state.focusLayer) !== idx) return;   // 늦게 옴 — 버림
      applyEdges(resp);
    }).catch((e) => console.warn(`[attention] 층 ${idx} 로드 실패:`, e.message));

    // 인접 ±2 프리페치 — 층 레일은 연속 이동이므로 대부분 적중해 왕복을 가린다(§5-2).
    for (const d of [1, -1, 2, -2]) {
      const j = idx + d;
      if (j >= 0 && j < attnLayerCount && !attnCache.has(j)) fetchAttn(j);
    }
  }

  function fetchAttn(idx) {
    if (attnCache.has(idx)) return attnCache.get(idx);
    const p = fetch(opts.attentionUrl(idx)).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    attnCache.set(idx, p);
    return p;
  }

  function applyEdges(resp) {
    clearEdges();
    const focusLayer = resp.layer + 1;          // attnIndexFor의 역
    const row = layerToRow.get(focusLayer);
    if (row == null) {
      // 서브샘플로 이 층의 노드 행이 빠진 경우 — 엣지의 끝점이 없으므로 그리지 않는다.
      // 층 레일이 서브샘플 층만 선택 가능하도록 막는 것은 단계 5/9-3의 일이다.
      console.warn(`[edges] 층 ${focusLayer}에 노드 행이 없습니다(서브샘플) — 엣지를 건너뜁니다.`);
      return;
    }
    edges = buildEdges(coordsRef, norm.pc1n[row], resp, lastSize);
    scene.add(edges.group);
    currentAttnResp = resp;   // token-focus 주석(§6-4)이 이 층의 attention을 찾을 때 쓴다
    requestRender();
    if (api.onAttention) api.onAttention({ layer: resp.layer, count: edges.count, dropped: edges.dropped, edges: resp.edges });
  }

  function clearEdges() {
    currentAttnResp = null;
    if (!edges) return;
    scene.remove(edges.group);
    edges.dispose();
    edges = null;
    requestRender();
  }

  function repaint() {
    paintNodes(nodes, state);
    if (trails) paintTrails(trails, state);
    if (decor) {
      decor.setFocus(state.focusLayer);
      decor.setDecision(state.decisionDepth);
    }
  }

  /**
   * §6 DOM 오버레이 갱신. **WebGL 프레임이 실제로 그려질 때만** 부른다(tick() 안에서) —
   * 카메라가 움직이지 않으면 라벨도 움직일 이유가 없고, on-demand 렌더 원칙(§4-6)을
   * DOM 쪽에도 그대로 적용하는 것이다.
   */
  function refreshOverlays() {
    if (!nodes || !coordsRef) return;
    const c = coordsRef;
    const rect = { width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 };
    const focusRow = layerToRow.get(state.focusLayer);
    const items = [];

    // §6-2 우선 3: 초점 층의 토큰 라벨. 노드 위로 살짝 띄운다(§6-3, NODE_R 오프셋).
    if (focusRow != null) {
      const y = c.y(state.focusLayer);
      for (let i = 0; i < c.T; i++) {
        const wp = new THREE.Vector3(c.x(i), y + c.NODE_R * 3, c.z(norm.pc1n[focusRow][i]));
        const { sx, sy, visible } = project(wp, camera, rect);
        items.push({
          key: `tok${i}`, cls: state.selectedToken === i ? 'label label--selected' : 'label',
          text: tokensData[i]?.text ?? String(i), sx, sy, visible, priority: 3,
        });
      }
    }

    // §6-2 우선 5: 층 눈금 3개(Emb·중간·최상단)만. 왼쪽 바깥에 세로로 늘어놓는다.
    const leftX = c.x(0) - c.NODE_R * 5;
    const mid = Math.round(c.L / 2);
    for (const [l, text] of [[0, 'Emb'], [mid, `L${mid - 1}`], [c.L, `L${c.L - 1}`]]) {
      const { sx, sy, visible } = project(new THREE.Vector3(leftX, c.y(l), 0), camera, rect);
      items.push({ key: `tick${l}`, cls: 'label label--tick', text, sx, sy, visible, priority: 5 });
    }

    labelLayer.update(items, shrunk);

    // 선택 말풍선(§6-2 우선 1, §6-3) — locked일 때만. hover만으로는 뜨지 않는다.
    if (state.locked && state.selectedToken != null && focusRow != null) {
      const i = state.selectedToken;
      const wp = new THREE.Vector3(c.x(i), c.y(state.focusLayer) + c.NODE_R * 6, c.z(norm.pc1n[focusRow][i]));
      const { sx, sy, visible } = project(wp, camera, rect);
      if (visible) {
        if (bubbleEl.dataset.token !== String(i)) {
          bubbleEl.dataset.token = String(i);
          bubbleEl.innerHTML = '';
          const l1 = document.createElement('div'); l1.className = 'bubble__label'; l1.textContent = `토큰 ${i}`;
          const l2 = document.createElement('div'); l2.className = 'bubble__value';
          l2.textContent = tokensData[i]?.text ?? String(i);
          bubbleEl.append(l1, l2);
        }
        bubbleEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${(sy - 44).toFixed(1)}px, 0)`;
        bubbleEl.classList.remove('hidden');
      } else bubbleEl.classList.add('hidden');
    } else {
      bubbleEl.classList.add('hidden');
      delete bubbleEl.dataset.token;
    }

    // 결정 깊이 주석 — 상시 1개(§6-4). 리더선은 **실제 결정 지점**(그 층, 마지막
    // 토큰의 노드)에서 시작해 무대 오른쪽 바깥의 말풍선까지 이어진다.
    //
    // ⚠️ 2026-08-27 리뷰: 예전엔 앵커가 `box.max.x`(상자 오른쪽 끝, Z=0)였다 —
    //    그 자리는 말풍선이 걸리는 자리와 사실상 같아서, "리더선"이 길이 0에 가까운
    //    제자리 꺾임이 되어 안 보였다(사용자가 "리더선이 없다"고 본 것이 정확했다).
    //    데이터가 실제로 있는 지점(결정 층·마지막 토큰의 3D 위치)에서 뽑아야
    //    선이 무언가를 "가리키는" 모양이 된다.
    if (box) {
      const dLayer = state.decisionDepth != null ? state.decisionDepth : c.L;
      const dY = c.y(dLayer);
      const dRow = layerToRow.get(dLayer);
      const lastTok = c.T - 1;
      const anchor = dRow != null
        ? new THREE.Vector3(c.x(lastTok), dY, c.z(norm.pc1n[dRow][lastTok]))
        : new THREE.Vector3(box.max.x, dY, 0);
      const { sx, sy, visible } = project(anchor, camera, rect);
      annotLayer.set('decision', visible ? { sx, sy, text: decisionText(state.decisionDepth) } : null);
    }

    // 상태 연동 주석 — **엣지 호버가 토큰 포커스보다 우선**(§7-1 표의 두 상태가 겹칠 수 없게).
    let text = null, pos = null;
    if (state.hoverEdge && focusRow != null) {
      text = edgeText(tokensData, state.hoverEdge);
      const { q, k } = state.hoverEdge;
      pos = project(new THREE.Vector3((c.x(q) + c.x(k)) / 2, c.y(state.focusLayer), 0), camera, rect);
    } else if (state.selectedToken != null && focusRow != null) {
      text = tokenAttentionText(tokensData, currentAttnResp, state.selectedToken);
      if (text) {
        const i = state.selectedToken;
        pos = project(new THREE.Vector3(c.x(i), c.y(state.focusLayer), c.z(norm.pc1n[focusRow][i])), camera, rect);
      }
    }
    annotLayer.set('hover', text && pos?.visible ? { sx: pos.sx, sy: pos.sy, text } : null);
  }

  /* ── R3-43 저사양 자동 감축 (§4-6) ────────────────────
   * 60프레임 평균 <30fps면 단계적으로 품질을 낮춘다. **antialias 끄기는 렌더러
   * 재생성이 필요한데, 그 과정이 `webglcontextlost`를 유발할 수 있어 boot.js의
   * 컨텍스트 손실 감시(§10-3)와 부딪힌다** — "의도된 재생성"과 "진짜 컨텍스트 유실"을
   * 구분하는 설계가 더 필요해서 이번엔 미룬다. pixelRatio·세그먼트·궤적 분할
   * 3단계만 구현한다(순서 번호는 유지 — 2번을 건너뛴다는 걸 명시하기 위해).
   */
  const perfMon = createPerfMonitor();
  function applyDegradation(name) {
    switch (name) {
      case 'pixelRatio':
        renderer.setPixelRatio(1);
        resize();
        break;
      case 'antialias':
        console.warn('[perf] antialias 끄기는 렌더러 재생성이 필요해 미구현이다 — 건너뜀.');
        break;
      case 'nodeSegments':
        if (nodes && coordsRef && norm) {
          const old = nodes;
          scene.remove(old.mesh);
          nodes = buildNodes(coordsRef, norm.pc1n, norm.layerOf, SEGMENTS_LOW);
          scene.add(nodes.mesh);
          old.dispose();
          paintNodes(nodes, state);
        }
        break;
      case 'trailSubdiv':
        if (trails && coordsRef && norm) {
          const old = trails;
          scene.remove(old.mesh);
          trails = buildTrails(coordsRef, norm.pc1n, norm.layerOf, SUBDIV_LOW);
          if (trails) scene.add(trails.mesh);
          old.dispose(scene);
          if (trails) paintTrails(trails, state);
        }
        break;
      default:
        return;
    }
    requestRender();
    if (api.onDegrade) api.onDegrade(name, perfMon.stage);
  }

  function clearScene() {
    clearEdges();
    attnCache.clear();
    if (decor) { scene.remove(decor.group); decor.dispose(); decor = null; }
    if (trails) {
      scene.remove(trails.mesh);
      trails.dispose(scene);   // 강조 궤적까지 함께 정리한다
      trails = null;
    }
    if (!nodes) return;
    scene.remove(nodes.mesh);
    nodes.dispose();     // §4-6 누수 감시 — 재분석 20회에도 memory가 늘지 않아야 한다
    nodes = null;
  }

  /* ── §7-2 피킹 ─────────────────────────────────────── */
  let pointerRafPending = false;
  let lastPointerPx = { x: -999, y: -999 };
  let pointerDown = null;   // {x,y,t} — 클릭과 드래그(회전)를 가르는 데 쓴다

  function clientToCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }

  function runPick(px, py, w, h) {
    if (!nodes || !coordsRef) return;
    const rect = { width: w, height: h };
    const hit = pickNode(nodes, coordsRef, norm.layerOf, norm.pc1n, camera, rect, px, py);
    if (hit) {
      if (!state.locked) setState({ selectedToken: hit.token, hoverEdge: null });
      else if (state.hoverEdge) setState({ hoverEdge: null });   // 노드가 잡히면 엣지 호버는 뗀다
      return;
    }
    const nx = (px / w) * 2 - 1, ny = -(py / h) * 2 + 1;
    const edge = edges ? pickEdge(edges.group, raycaster, camera, nx, ny) : null;
    if (edge) {
      setState({ hoverEdge: edge, ...(state.locked ? {} : { selectedToken: null }) });
    } else if (state.hoverEdge || (!state.locked && state.selectedToken != null)) {
      setState({ hoverEdge: null, ...(state.locked ? {} : { selectedToken: null }) });
    }
  }

  const onPointerMove = (e) => {
    const p = clientToCanvas(e);
    // 2px 미만 이동은 건너뛴다(§7-2) — 레이캐스트는 공짜가 아니다.
    if (Math.hypot(p.x - lastPointerPx.x, p.y - lastPointerPx.y) < 2) return;
    lastPointerPx = { x: p.x, y: p.y };
    if (pointerRafPending) return;
    pointerRafPending = true;
    requestAnimationFrame(() => { pointerRafPending = false; runPick(p.x, p.y, p.w, p.h); });
  };
  canvas.addEventListener('pointermove', onPointerMove);

  const onPointerLeave = () => {
    if (!state.locked) setState({ selectedToken: null });
    if (state.hoverEdge) setState({ hoverEdge: null });
  };
  canvas.addEventListener('pointerleave', onPointerLeave);

  const onPointerDown = (e) => { pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onPointerUp = (e) => {
    if (!pointerDown) return;
    const moved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
    const dt = performance.now() - pointerDown.t;
    pointerDown = null;
    // 드래그(회전)와 클릭(선택)을 가른다 — OrbitControls는 자기 판단으로 회전을 시작하므로
    // 여기서 또 픽킹하면 회전 끝에 엉뚱한 노드가 찍힌다.
    if (moved > 4 || dt > 500) return;
    const p = clientToCanvas(e);
    if (!nodes || !coordsRef) return;
    const hit = pickNode(nodes, coordsRef, norm.layerOf, norm.pc1n, camera, { width: p.w, height: p.h }, p.x, p.y);
    if (hit) {
      // §7-1 node-select: 이미 이 토큰이 고정돼 있으면 재클릭으로 해제.
      if (state.locked && state.selectedToken === hit.token) setState({ selectedToken: null, locked: false });
      else setState({ selectedToken: hit.token, locked: true, hoverEdge: null });
    } else if (state.locked) {
      setState({ selectedToken: null, locked: false });
    }
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);

  /* ── §7-1 키보드 (S-07) ────────────────────────────────
   * 슬라이더에 포커스가 가 있을 때는 그 입력 요소의 고유 동작(예: range의 ←→)을
   * 건드리지 않는다 — 그래서 활성 요소가 폼 컨트롤이면 이 핸들러는 물러난다. */
  const onKeydown = (e) => {
    const ae = document.activeElement;
    if (ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
    if (!coordsRef) return;
    const L = coordsRef.L, T = coordsRef.T;
    switch (e.key) {
      case 'ArrowUp':   setState({ focusLayer: Math.min(L, state.focusLayer + 1) }); break;
      case 'ArrowDown':  setState({ focusLayer: Math.max(0, state.focusLayer - 1) }); break;
      case 'PageUp':    setState({ focusLayer: Math.min(L, state.focusLayer + 5) }); break;
      case 'PageDown':  setState({ focusLayer: Math.max(0, state.focusLayer - 5) }); break;
      case 'Home':      setState({ focusLayer: 0 }); break;
      case 'End':       setState({ focusLayer: L }); break;
      case 'ArrowRight': {
        const cur = state.selectedToken ?? -1;
        setState({ selectedToken: Math.min(T - 1, cur + 1), locked: false, hoverEdge: null });
        break;
      }
      case 'ArrowLeft': {
        const cur = state.selectedToken ?? T;
        setState({ selectedToken: Math.max(0, cur - 1), locked: false, hoverEdge: null });
        break;
      }
      case 'Enter':
        if (state.selectedToken != null && !state.locked) setState({ locked: true });
        break;
      case 'Escape':
        setState({ selectedToken: null, locked: false, hoverEdge: null });
        break;
      // §5-3·A-02: +/- 줌, 단계 8%.
      // ⚠️ 이 vendor 버전의 `dollyIn`/`dollyOut`은 이름과 실제 동작이 반대다 —
      // `dollyOut(s)`는 내부에서 `_scale /= s` 후 `radius *= _scale`을 해서 **거리가
      // 줄어든다**(가까워짐, 실제로는 zoom-in). 이름을 믿고 짰다가 실측(距離 46.83→43.36,
      // '-' 키인데 가까워짐)으로 뒤집힌 걸 확인했다. 그래서 이름과 반대로 매핑한다.
      case '+': case '=': controls.dollyOut(1.08); controls.update(); requestRender(); break;
      case '-': case '_': controls.dollyIn(1.08); controls.update(); requestRender(); break;
      // '1'/'2'/'3' 프리셋 키는 여기서 처리하지 않는다 — boot.js가 프리셋 버튼의
      // aria-pressed 표시도 함께 바꿔야 하는데, main.js가 카메라만 옮기면 버튼 UI가
      // 3/4에 멈춰 있는 채로 어긋난다(실측으로 확인). boot.js가 버튼 클릭과 같은
      // 경로로 처리하도록 위임한다.
      default: return;
    }
    e.preventDefault();
  };
  window.addEventListener('keydown', onKeydown);

  function dispose() {
    disposed = true;
    if (rafId) cancelAnimationFrame(rafId);
    ro.disconnect();
    stageEl.removeEventListener('wheel', onWheel, { capture: true });
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('keydown', onKeydown);
    controls.dispose();
    labelLayer.dispose();
    annotLayer.dispose();
    clearScene();
    renderer.dispose();
  }

  resize();

  const api = {
    scene, camera, renderer, controls,
    setData, setState, applyPreset, requestRender, resize, dispose,
    // §5-4: 스크롤 연동 sticky shrink가 무대 크기를 바꾼 뒤 부른다. userAdjusted가 아니면
    // 같은 프리셋으로 거리만 다시 맞춘다. 라벨 상한도 24→10으로 낮아진다(§6-2).
    refit,
    setShrink(v) { shrunk = !!v; requestRender(); },
    // 수동으로도 부를 수 있게 공개한다 — 검증용이자, 나중에 "저사양 모드" 수동 토글이
    // 생기면 그대로 쓸 수 있다. 'pixelRatio'|'antialias'|'nodeSegments'|'trailSubdiv'.
    applyDegradation,
    get userAdjusted() { return userAdjusted; },
    onThemeChange() { invalidateTheme(); scene.background = cssColor('--paper');
                      renderer.setClearColor(cssColor('--paper'), 1);
                      if (nodes) repaint(); requestRender(); },
    // 호출측이 채우는 선택적 훅. attention 지연 로드가 반영될 때마다 부른다
    // ({layer,count,dropped} 또는 null=이 층엔 attention이 없음, 예: Embedding).
    onAttention: null,
    // state가 바뀔 때마다 부른다(§7-3 밴드 제목 연동). setData 직후에도 한 번 부른다.
    onStateChange: null,
    // R3-43: 자동 감축이 일어날 때마다 부른다(name, 누적 단계 수). 상태 줄 안내용(§4-6).
    onDegrade: null,
    get state() { return state; },   // boot.js가 밴드 제목(§7-3)을 갱신할 때 읽는다
    get info() { return { ...renderer.info.memory, calls: frame.calls, frames: frame.count }; },
    get motionMs() { return { t2: cssMs('--t-2'), t3: cssMs('--t-3'), t4: cssMs('--t-4') }; },
  };
  return api;
}

/** 놀람도(bits)를 0~1로. 첫 토큰은 null이다(앞이 없어 예측 대상이 아니다). */
function normalizeSurprisal(sur) {
  if (!Array.isArray(sur)) return null;
  const vals = sur.filter((v) => v != null);
  if (!vals.length) return null;
  // 상한을 데이터 최대가 아니라 고정값으로 잡으면 프롬프트마다 색 의미가 달라진다.
  // 최대로 정규화한다 — 대신 캡션이 실제 bits 범위를 함께 적는다.
  const hi = Math.max(...vals) || 1;
  return sur.map((v) => (v == null ? null : Math.min(1, v / hi)));
}
