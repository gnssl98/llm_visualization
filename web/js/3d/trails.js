/**
 * trails — 토큰별 세로 궤적. 사양서 §3-3. **3D 전용 표현 ①**
 *
 * 2D 산점도가 못 보여주는 것이 이것이다: 한 토큰이 층을 거치며 의미 축에서
 * 어떻게 움직였는가. 층을 따라 이은 선 하나가 그 이야기를 담는다.
 *
 * 형태는 **TubeGeometry(월드 단위)** 다(§3-3 v1.5 A/B 확정). 화면 단위 선과 달리
 * 원근에 따라 굵기가 줄어들어 깊이 단서가 된다. 반대로 attention 엣지는 굵기가
 * **값**을 뜻하므로 줌에 반응하면 안 되고, 그래서 거기만 화면 단위를 쓴다.
 *
 * 96개를 **하나로 병합**한다. 근거는 성능이 아니다 — 실측에서 draw call 96과 1의
 * 차이가 개발 머신에서는 관측되지 않았다(§3-3 v1.5). 채택 이유는 셋이다:
 *   ① 발표 노트북(내장 GPU) 대비 보험
 *   ② 선택 강조를 정점 색 부분 갱신 한 번으로 끝낼 수 있다
 *   ③ 궤적에는 피킹을 하지 않으므로(§7-2는 노드만) 병합의 통상적 단점이 없다
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cssColor, mixToPaper } from './theme.js';

/** §4-6 자동 감축: 8 → 3분할. 꺾인 선은 노이즈처럼 보이므로 기본은 8이다. */
export const SUBDIV_DEFAULT = 8;
export const SUBDIV_LOW = 3;

/** 관 둘레 분할. 궤적은 1px 남짓이라 4면이면 육안으로 원과 구분되지 않는다. */
const RADIAL = 4;

/**
 * 관 **반지름** = 이 값 × DX.
 *
 * 노드 지름이 기본 뷰에서 약 5.1px이고 노드 반지름 = 0.26 × DX이므로,
 * 궤적 지름을 노드 지름의 0.24배(≈1.2px)로 두려면
 *   반지름 = 0.24 × 0.26 × DX / 2 ... 가 아니라 **0.24 × 0.26 × DX = 0.062 × DX** 이다
 *   (궤적 지름 = 2R, 노드 지름 = 2 × 0.26 × DX → R = 0.24 × 0.26 × DX).
 *
 * ⚠️ 처음에 0.024로 뒀는데 반지름과 지름을 혼동한 값이었다. 화면에서 0.47px,
 *    즉 **서브픽셀이라 궤적이 보이지 않았다.** 사양서 §3-3의 "폭 1.0px"은
 *    화면 단위 선을 전제한 표현이라 월드 단위 관으로는 이렇게 역산해야 한다.
 *
 * ⚠️⚠️ 2026-08-27 디자인 리뷰: 그 역산(0.062 → 지름 1.2px, 노드 지름의 24%)도
 *    실측에서는 **7토큰짜리 가장 쉬운 장면에서조차 안 보였다.** 1.2px는 이론상의
 *    지오메트리 지름이지, 화면에 실제로 덮이는 픽셀 수가 아니다 — 안티에일리어싱과
 *    카메라 원근(월드 단위라 뒤로 물러날수록 더 얇아짐)이 겹치면 서브픽셀로 사라진다.
 *    지름을 노드 지름의 40%로 올린다 — "선"이 아니라 "가는 리본"으로 보일 정도라야
 *    실측에서 살아남는다는 것을 이번에 확인했다.
 */
const TRAIL_R_RATIO = 0.10;
/** 선택된 궤적은 더 굵게(§3-3의 1.0px → 2.6px에 대응). */
const TRAIL_R_SELECTED = 2.6;

const ALPHA = {
  // 기본값도 0.22 → 0.42로 올렸다. "있는 듯 없는 듯"의 의도는 유지하되,
  // 0.22는 종이색과 섞이는 mixToPaper를 거치면 사실상 무채색 배경과 구분이 안 됐다.
  base:     0.42,
  selected: 1.0,
  receded:  0.08,   // 선택이 있을 때 나머지 — 여긴 그대로. "선택 안 한 건 죽는다"가 의도다
};

/**
 * @param {object} c makeCoords() 결과
 * @param {number[][]} pc1n [rows][T]
 * @param {(row:number)=>number} layerOf
 * @param {number} [subdiv]
 */
export function buildTrails(c, pc1n, layerOf, subdiv = SUBDIV_DEFAULT) {
  const rows = pc1n.length;
  const T = c.T;
  if (rows < 2) return null;                  // 층이 하나면 이을 것이 없다

  const radius = TRAIL_R_RATIO * c.DX;
  const tubular = (rows - 1) * subdiv;
  const ringSize = RADIAL + 1;                // TubeGeometry는 이음매 정점을 중복해 둔다
  const perTrail = (tubular + 1) * ringSize;

  const geos = [];
  for (let i = 0; i < T; i++) {
    const pts = [];
    for (let r = 0; r < rows; r++) {
      pts.push(new THREE.Vector3(c.x(i), c.y(layerOf(r)), c.z(pc1n[r][i])));
    }
    // 꺾인 선은 데이터가 아니라 노이즈처럼 보인다 → CatmullRom으로 부드럽게(§3-3).
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const g = new THREE.TubeGeometry(curve, tubular, radius, RADIAL, false);
    // MeshBasicMaterial은 법선을 쓰지 않는다. 지우면 정점당 12바이트를 아낀다
    // (32B 최악에서 약 4MB). uv도 마찬가지.
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    geos.push(g);
  }

  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  if (!merged) return null;

  const vertCount = merged.attributes.position.count;
  merged.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));

  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.frustumCulled = false;

  // 선택된 궤적 하나만 굵게 그리는 별도 배치. 없을 때는 씬에 넣지 않는다.
  // 궤적 하나(65점 × 8분할)를 다시 만드는 비용은 1ms 미만이라 매번 새로 만든다.
  let hi = null;

  const api = {
    mesh, rows, T, tubular, ringSize, perTrail, radius, layerOf, subdiv,
    get highlight() { return hi; },

    /** 토큰 i의 정점 구간 [start, end). 부분 색 갱신에 쓴다. */
    rangeOf(i) { return [i * perTrail, (i + 1) * perTrail]; },
    /** 궤적 안의 정점 인덱스 → 층 번호. 링 하나가 곡선 위 한 점이다. */
    layerAtVertex(vLocal) {
      const ring = Math.floor(vLocal / ringSize);
      return layerOf(Math.min(rows - 1, Math.round(ring / subdiv)));
    },

    /** 선택 토큰의 굵은 궤적을 만든다. i가 null이면 없앤다. */
    setHighlight(i, scene) {
      if (hi) { scene.remove(hi); hi.geometry.dispose(); hi.material.dispose(); hi = null; }
      if (i == null) return null;
      const pts = [];
      for (let r = 0; r < rows; r++) {
        pts.push(new THREE.Vector3(c.x(i), c.y(layerOf(r)), c.z(pc1n[r][i])));
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
      const g = new THREE.TubeGeometry(curve, tubular, radius * TRAIL_R_SELECTED, RADIAL, false);
      g.deleteAttribute('normal');
      g.deleteAttribute('uv');
      hi = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: cssColor('--ink') }));
      hi.frustumCulled = false;
      scene.add(hi);
      return hi;
    },

    dispose(scene) {
      if (hi && scene) scene.remove(hi);
      if (hi) { hi.geometry.dispose(); hi.material.dispose(); hi = null; }
      merged.dispose();
      mat.dispose();
    },
  };
  return api;
}

/**
 * 궤적 색을 칠한다. **지오메트리는 건드리지 않는다.**
 *
 * @param {object} tr buildTrails() 결과
 * @param {object} st nodes.paintNodes와 같은 상태 객체
 */
/** intro.js(등장 시퀀스)가 궤적의 "평소" 기본색을 알아야 할 때 쓴다.
 *  paintTrails와 같은 값을 내야 하므로 그 안의 계산을 그대로 재사용한다. */
export function resolveTrailBaseColor() {
  return mixToPaper(cssColor('--ink-4'), ALPHA.base);
}

export function paintTrails(tr, st) {
  const { mesh, T, perTrail } = tr;
  const col = mesh.geometry.attributes.color;

  const ink = cssColor('--ink');
  const ink4 = cssColor('--ink-4');
  const signal = cssColor('--signal');

  const hasSel = st.selectedToken != null;
  const cBase = mixToPaper(ink4, hasSel ? ALPHA.receded : ALPHA.base);
  const cSel = mixToPaper(ink, ALPHA.selected);
  const cInk = mixToPaper(ink, ALPHA.selected);
  const cSignal = mixToPaper(signal, ALPHA.selected);

  const last = T - 1;
  for (let i = 0; i < T; i++) {
    const [s, e] = tr.rangeOf(i);
    // 마지막 토큰(답을 만드는 자리)만 결정 깊이 위아래로 색이 갈린다.
    // **색이 바뀌는 그 지점이 §3-6의 "굳는 순간"이다** — 여기가 이 화면의 요점이라
    // 다른 궤적에는 절대 같은 처리를 하지 않는다(시그널 색 대상은 화면에 하나뿐, §15-3).
    const split = i === last && st.decisionDepth != null;
    if (!split) {
      const c = st.selectedToken === i ? cSel : cBase;
      for (let v = s; v < e; v++) col.setXYZ(v, c.r, c.g, c.b);
      continue;
    }
    for (let v = s; v < e; v++) {
      const l = tr.layerAtVertex(v - s);
      const c = l >= st.decisionDepth ? cSignal : cInk;
      col.setXYZ(v, c.r, c.g, c.b);
    }
  }
  col.needsUpdate = true;
}
