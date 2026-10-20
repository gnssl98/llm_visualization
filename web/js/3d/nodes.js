/**
 * nodes — 층×토큰 노드. 사양서 §3-2 / §4-4.
 *
 * 32B 최악에서 65 × 96 = 6,240개다. `InstancedMesh` **1개**로 그린다(draw call 1).
 *
 * 절대 규칙 두 가지 (§3-2, §15-3):
 *   ① **크기는 전 노드 동일.** 크기로 값을 표현하지 않는다 — 원근이 크기를 이미
 *      바꾸고 있어서, 크기 인코딩은 깊이와 값이 뒤섞여 읽을 수 없게 된다.
 *   ② **색 리터럴 금지.** 색은 theme.js를 통해서만 온다.
 *
 * 형태는 납작한 원기둥이다. 순수 원반(두께 0)은 정면 뷰에서 선으로 사라진다.
 */
import * as THREE from 'three';
import { cssColor, mixToPaper, seqColor } from './theme.js';

/** §4-6 자동 감축이 낮추는 값. 16 → 8. */
export const SEGMENTS_DEFAULT = 16;
export const SEGMENTS_LOW = 8;

/** §3-2 상태별 색·불투명도. 색 **이름**만 둔다 — 값은 theme이 안다. */
const STATE = {
  base:      { token: '--ink-4', alpha: 0.35 },
  focus:     { token: '--ink',   alpha: 1.0 },
  adjacent:  { token: '--ink-3', alpha: 0.6 },
  selected:  { token: '--ink',   alpha: 0.9 },
  decided:   { token: '--signal', alpha: 1.0 },
};

/**
 * 노드 배치를 만든다.
 * @param {object} c      makeCoords() 결과
 * @param {number[][]} pc1n  [rows][T] 정규화된 PC1
 * @param {(row:number)=>number} layerOf  행 인덱스 → 층 번호 (subsample 대응)
 * @param {number} [segments]
 */
export function buildNodes(c, pc1n, layerOf, segments = SEGMENTS_DEFAULT) {
  const rows = pc1n.length;
  const T = c.T;
  const count = rows * T;

  // normal = +Y 인 원기둥. CylinderGeometry의 기본 축이 이미 Y라 회전이 필요 없다.
  // 크기는 **좌표계에서 받는다** — DX가 T에 따라 정해지므로 노드도 함께 정해진다.
  // 모듈 상수로 두면 간격이 좁아진 문장에서 노드끼리 겹친다.
  const geo = new THREE.CylinderGeometry(c.NODE_R, c.NODE_R, c.NODE_H, segments);
  // 조명이 없으므로 Basic. 이 화면은 물체가 아니라 도표다 — 음영은 값을 왜곡한다.
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  // 위치는 분석마다 한 번만 쓴다. 색만 매 상호작용에 바뀐다(§4-6).
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.frustumCulled = false;   // 하나의 배치가 씬 전체를 덮으므로 컬링이 의미 없다

  const m = new THREE.Matrix4();
  for (let r = 0; r < rows; r++) {
    const y = c.y(layerOf(r));
    for (let i = 0; i < T; i++) {
      m.makeTranslation(c.x(i), y, c.z(pc1n[r][i]));
      mesh.setMatrixAt(r * T + i, m);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;

  // instanceColor는 InstancedMesh가 지연 생성하므로 미리 만들어 둔다.
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

  return {
    mesh, rows, T, count, layerOf,
    /** (row, token) → 인스턴스 인덱스. picking(§7-2)이 역으로도 쓴다. */
    indexOf: (r, i) => r * T + i,
    rowOf: (idx) => Math.floor(idx / T),
    tokenOf: (idx) => idx % T,
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/**
 * 색을 통째로 다시 칠한다. **지오메트리는 건드리지 않는다**(§4-6).
 *
 * 층/토큰 선택은 자주 일어나므로 여기가 상호작용의 비용을 결정한다.
 * 6,240개 전체를 도는 것은 32B에서도 1ms 미만이라 부분 갱신 최적화는 아직 불필요하다.
 *
 * @param {object} nodes buildNodes() 결과
 * @param {object} st
 * @param {number} st.focusLayer      초점 층 번호
 * @param {number|null} st.selectedToken 선택된 토큰
 * @param {number|null} st.decisionDepth 결정 깊이(층 번호). null이면 그리지 않는다
 * @param {number[]|null} st.surprisal  토큰별 놀람도 0~1 (Emb 층 전용)
 */
/**
 * §3-2 상태별 최종 색을 한 번 계산해 돌려준다. `paintNodes`와 `intro.js`(등장 시퀀스)가
 * **같은 색**을 써야 하므로 공용으로 뺐다 — 애니메이션 도중 값과 정착 후 값이 다르면
 * 등장이 끝나는 순간 색이 툭 튄다.
 */
export function resolveNodeColors() {
  const c = {};
  for (const [k, v] of Object.entries(STATE)) c[k] = mixToPaper(cssColor(v.token), v.alpha);
  return c;
}

export function paintNodes(nodes, st) {
  const { mesh, rows, T, layerOf } = nodes;
  const col = mesh.instanceColor;

  // 색 조회는 캐시되지만 lerp가 매번 새 객체를 만든다 → 상태별로 한 번만 계산한다.
  const c = resolveNodeColors();

  // 놀람도는 **Emb 층에만** 칠한다. 모든 층에 칠하면 입력 토큰의 속성이 층 정보를
  // 덮어써서, 위로 올라가도 색이 안 변하는 것처럼 보인다(§3-2).
  const seq = st.surprisal
    ? st.surprisal.map((s) => (s == null ? null : mixToPaper(seqColor(s), 0.9)))
    : null;

  const lastToken = T - 1;
  for (let r = 0; r < rows; r++) {
    const l = layerOf(r);
    const dl = Math.abs(l - st.focusLayer);
    const rowState = dl === 0 ? c.focus : dl === 1 ? c.adjacent : c.base;
    for (let i = 0; i < T; i++) {
      let use = rowState;
      if (st.selectedToken === i) use = c.selected;
      // 결정 깊이 이상 · 마지막 토큰 위치 — 이 화면의 시그널 색 대상은 여기 하나뿐이다.
      // 한 화면에 시그널 대상이 2개 이상이면 반려다(§15-3).
      if (st.decisionDepth != null && l >= st.decisionDepth && i === lastToken) use = c.decided;
      else if (l === 0 && seq && seq[i]) use = seq[i];
      col.setXYZ(r * T + i, use.r, use.g, use.b);
    }
  }
  col.needsUpdate = true;
}
