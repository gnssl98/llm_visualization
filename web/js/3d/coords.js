/**
 * coords — 3D 좌표계. 사양서 §2.
 *
 * 이 파일은 씬 전체가 얹히는 바닥이다. **three.js에 의존하지 않는다** —
 * 순수 함수만 두어 브라우저 없이 숫자로 검증할 수 있게 한다(`tools/test_coords.mjs`).
 *
 *        Y (층)
 *        ↑  L23 ── 최상단, 여기서 답이 나온다
 *        │   ⋮
 *        │  Emb ── 바닥
 *        └──────────→ X (토큰 순서, 문장 읽는 방향)
 *       ╱
 *      Z (의미 축 = PC1, 앞뒤)
 *
 * X와 Y는 **고정 격자**다. 데이터에 따라 움직이지 않는다.
 * Z만이 데이터 구동 좌표이며, 그래서 §2-3의 정규화 규칙이 전부 Z에 걸린다.
 */

/* ── §2-2 스케일 상수 ─────────────────────────────────── */

export const DX_MAX = 1.0;      // 토큰 간격 상한 (짧은 문장은 이 값 그대로)
/** 하한. **노드 겹침 방지가 아니다** — 노드 반지름이 DX에 비례하므로 비율이 고정되어
 *  아무리 좁혀도 겹치지 않는다(처음에 그렇게 적었으나 틀렸다). 이 값은 병적으로 긴
 *  입력(MAX_TOKENS를 크게 올리는 경우 등)에서 씬이 한 점으로 수축해 카메라가 near
 *  평면에 닿는 것을 막는 안전장치다. 현재 MAX_TOKENS=96에서는 걸리지 않는다. */
export const DX_MIN = 0.15;
export const H0 = 14.0;         // 기준 총 높이 (L=24 기준)
export const ZMAX = 2.6;        // 의미 축 최대 진폭 (±)
/**
 * 상자의 목표 종횡비(총 가로 / 총 세로).
 *
 * **무대 종횡비에 맞춘다.** §9-1의 무대는 폭 ≤1180px · 높이 75vh라
 * 일반적인 노트북에서 1.4~1.9:1 범위다(1440×900 → 1.68, 1920×1080 → 1.40).
 * 그 가운데를 잡는다.
 *
 * ⚠️ **뷰포트에서 계산하지 않는다.** 창 크기에 DX가 반응하면 리사이즈마다
 *    노드 위치가 바뀌어 InstancedMesh를 다시 만들어야 하고, 같은 분석인데
 *    창을 줄였다고 그림이 달라진다. 고정 상수여야 한다.
 *
 * 2.4로 잡았을 때 실측: 세로 55%만 사용, 층 간격 6.1px. 1.7에서 각각 77% · 8.6px.
 */
export const ASPECT_TARGET = 1.7;
/**
 * §2-2 디자인 리뷰(2026-08-27)에서 확인된 두 번째 버그의 수정.
 *
 * `ASPECT_TARGET`은 **정면(X:Y)** 만 억제한다. 그런데 Z는 `ZMAX=2.6` 고정폭이라,
 * X가 아무리 눌려도 T가 크면 X:Z는 그대로 벌어진다. 실측(59토큰): X:Z ≈ **10.7:1**,
 * 측면 뷰가 "23:1 얇은 판자"로 보인 원인이 이것이었다 — 세로(Y)를 고친 다음에도
 * 깊이(Z) 쪽은 손대지 않고 남아 있던 구멍이다.
 *
 * 이 상수는 X:Z가 넘지 않을 상한이다. 2.2로 잡은 근거: 1.0 이하(정육면체에 가깝게)로
 * 조이면 문장이 늘 정사각형처럼 보여 "읽는 방향"이라는 X의 의미가 사라지고, 3.0을
 * 넘기면 다시 판자로 되돌아간다(사용자가 "23:1"을 즉시 "얇은 판자"로 읽었던 것과 같은
 * 지각이 3:1 근처에서부터 이미 시작된다). 2~2.5 사이에서 골랐다.
 */
export const Z_ASPECT_TARGET = 2.2;
export const NODE_R_RATIO = 0.26;       // 노드 반지름 = 이 값 × DX
/**
 * 원반 두께 = 이 값 × 반지름.
 *
 * ⚠️ 2026-08-27 리뷰: 0.28이면 정면·측면 뷰에서 폭:높이가 7.1:1이다(원기둥 축이
 * +Y라 그 방향에서는 항상 옆면 실루엣만 보인다 — 두께를 아무리 줘도 "원"으로는
 * 안 보이고, 얇을수록 "선"에 가까워진다). 실측 스크린샷에서 노드가 점이 아니라
 * 대시(-) 여러 개로 읽혔다. 0.55로 올려 3.6:1로 줄인다 — 완전한 원반은 못 되지만
 * (3/4 기본 시점의 "얇은 도표 마커" 느낌은 유지하고 싶어 구체로 바꾸지 않았다)
 * 최소한 "선"이 아니라 "짧은 알약" 모양으로는 읽혀야 한다.
 */
export const NODE_H_RATIO = 0.55;

/**
 * 토큰 간격. **T에 따라 정해진다** — 상수가 아니다.
 *
 * 구 사양의 `DX = 1.0` 고정은 세로만 √로 억제하고 가로는 놔둔 것이라,
 * 상자가 항상 가로로 길었다(96토큰 32B에서 96 : 22.86 = **4.2 : 1**).
 * 무대(≈1.57:1)에 맞추려면 가로 기준으로 물러나야 하고, 그러면 **세로를 32%만 쓴다.**
 * 실측에서 64개 층이 229px 안에 들어가 **층당 3.6px** — 층이 구분되지 않았다.
 *
 * ⚠️ 노리는 이득은 **층 간격**이지 노드 크기가 아니다. `NODE_R`이 DX에 비례하므로
 *    DX를 줄이면 카메라가 가까워지는 만큼 노드도 작아져 화면상 크기는 상쇄된다
 *    (실측 5.2px → 5.0px). 노드 크기는 `화면 폭 ÷ 토큰 수`로 이미 묶여 있다.
 *
 * §2-1의 "X는 고정 격자"는 지켜진다 — 그 규칙의 뜻은 *데이터 값에 반응하지 않는다*이지
 * *상수여야 한다*가 아니다. 한 번의 분석 안에서 간격은 완전히 균일하다.
 * H가 L에 따라 정해지는 것과 같은 성격이다.
 *
 * 짧은 문장은 `DX_MAX`에 걸려 예전과 같다. 이때 상자는 세로로 길어지는데,
 * 그 경우 카메라가 **세로 기준**으로 맞추므로 층 간격은 이미 최대다 — 늘릴 이유가 없다.
 *
 * **두 후보 중 더 좁은 쪽을 쓴다.** `wantFront`는 정면 종횡비(X:Y)를 `ASPECT_TARGET`에
 * 맞추고, `wantSide`는 측면 종횡비(X:Z)를 `Z_ASPECT_TARGET`에 맞춘다. 둘을 동시에
 * 정확히 맞출 수는 없다(문장이 길수록 두 목표가 서로 다른 DX를 원한다) — 더 좁은 쪽을
 * 택하면 정면은 목표보다 살짝 여백이 남을 뿐이지만, 더 넓은 쪽(=front만)을 택하면
 * 측면이 판자로 되돌아간다. 정면의 여백은 값싸고 측면의 붕괴는 비싸므로 min이다.
 */
export function dxFor(L, T) {
  if (T <= 1) return DX_MAX;
  const wantFront = (ASPECT_TARGET * heightFor(L)) / (T - 1);
  const wantSide = (Z_ASPECT_TARGET * (2 * ZMAX)) / (T - 1);
  return clamp(Math.min(wantFront, wantSide), DX_MIN, DX_MAX);
}

/**
 * 총 높이는 **층 수의 제곱근**에 비례한다.
 *
 * 선형이면 64층이 24층의 2.7배가 되어 화면에 담으려다 노드가 뭉개지고,
 * 완전 고정이면 실루엣이 똑같아져 모델 간 비교할 게 없어진다.
 * 제곱근이면 층 4배에 높이 1.6배 — 담기면서 차이도 남는다.
 *
 * ⚠️ 구 사양의 `DY = clamp(0.35, 14/L, 1.2)`는 L=64에서 하한에 걸려
 *    총 높이가 22.4로 커졌다. "총 높이 14"를 달성하지 못하는 버그였다.
 */
export function heightFor(L) {
  return H0 * Math.sqrt(L / 24);
}

/**
 * 한 번의 분석에 대한 좌표 함수 묶음을 만든다.
 * @param {number} L  층 수(= n_layers). 노드 행은 L+1개다(l=0이 Embedding).
 * @param {number} T  토큰 수.
 */
export function makeCoords(L, T) {
  const H = heightFor(L);
  const DY = H / L;
  const DX = dxFor(L, T);
  // 노드 크기는 DX에 비례한다 — 간격이 좁아지면 노드도 좁아져야 서로 붙지 않는다.
  // 한 분석 안에서는 **전 노드 동일**이라는 §3-2 절대 규칙은 그대로다.
  const NODE_R = NODE_R_RATIO * DX;
  const NODE_H = NODE_H_RATIO * NODE_R;
  return {
    L, T, H, DY, DX, ZMAX, NODE_R, NODE_H,
    // 문장 가운데가 원점에 오도록 민다. 토큰 수가 달라져도 시선이 중앙에 머문다.
    x: (i) => (i - (T - 1) / 2) * DX,
    y: (l) => l * DY,
    // pc1n은 이미 §2-3에서 PC1_SCALE로 나눈 값이다. 여기서는 표시 범위로만 자른다.
    z: (pc1n) => clamp(pc1n, -1, 1) * ZMAX,
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ── §2-3 PC1 정규화 ──────────────────────────────────── */

/**
 * 백엔드가 준 `hidden_proj_3d`를 화면 좌표용 정규화 값으로 바꾼다.
 *
 * **여기서 PCA를 다시 하지 않는다.** 전역 기저·부호 고정·시점 정렬·결정론은
 * 전부 서버(`panels._hidden_projection`)가 이미 처리했다. 프론트가 손대면
 * 같은 것을 두 곳에서 계산하게 되고, 그게 이 프로젝트에서 반복된 사고의 원인이었다.
 *
 * 프론트가 하는 일은 둘뿐이다: ① scale로 나눈다 ② 표시 범위로 자른다.
 * scale을 서버가 아니라 여기서 곱하는 이유는 사용자가 스케일을 바꿔볼 수 있어야
 * 하기 때문이다(그래서 서버는 `pc1`을 **정규화 전 원값**으로 보낸다).
 *
 * @param {{pc1:number[][], pc1_scale:number, squashed:number, squashed_limit:number,
 *          evr:number, overflow:number, method:string, sign_fixed:boolean}} proj3d
 * @param {{stride:number, shown:number, total:number, layers:number[]}|null} subsample
 * @param {number} [scaleMul=1] 사용자가 만지는 배율. 1이 사양 기본값.
 */
export function normalizePC1(proj3d, subsample = null, scaleMul = 1) {
  const scale = proj3d.pc1_scale * scaleMul;
  // scale ≤ 0이면 0으로 나눈다. 서버가 막고 있지만(계약 테스트) 여기서도 방어한다 —
  // 화면이 NaN 좌표로 통째로 사라지는 것보다 평평한 축이 낫다.
  const div = scale > 0 ? scale : 1;
  const pc1n = proj3d.pc1.map((row) => row.map((v) => clamp(v / div, -1, 1)));

  // 층 stride가 걸린 경우 pc1 행 인덱스 ≠ 층 번호다. 매핑을 명시적으로 들고 다닌다.
  // 이걸 암묵으로 두면 "왜 32층 궤적이 8층에 그려지나"로 돌아온다.
  const layerOf = subsample
    ? (row) => subsample.layers[row]
    : (row) => row;

  return {
    pc1n,
    layerOf,
    rows: pc1n.length,
    scale,
    // 아래 넷은 캡션이 그대로 읽는다. 숨기지 않는 것이 §2-3-2의 요구다.
    evr: proj3d.evr,
    overflow: proj3d.overflow,
    method: proj3d.method,
    squashed: proj3d.squashed,
    // 경고 임계는 서버가 함께 내려준다 — 프론트에 20%를 하드코딩하지 않는다.
    squashedLimit: proj3d.squashed_limit,
  };
}

/**
 * §2-3-2 런타임 가드. **QA 통과는 아무것도 보증하지 않는다** — 사용자가 카탈로그 밖
 * HF repo id를 직접 넣을 수 있으므로(F-31), 축이 정보를 못 담는 조합이 언제든 들어온다.
 * 그때 화면이 아무 말도 안 하면 사용자는 "이 모델은 의미 변화가 없다"고 **정반대로** 읽는다.
 *
 * 문구 키만 돌려주고 문자열은 i18n이 담당한다(§12).
 * @returns {string[]} 캡션 옆에 띄울 경고 키 목록. 없으면 빈 배열.
 */
export function axisWarnings(norm) {
  const out = [];
  if (norm.squashedLimit != null && norm.squashed > norm.squashedLimit) out.push('axisSquashed');
  if (norm.overflow > 5) out.push('axisOverflow');
  return out;
}

/* ── 카메라가 씬을 담기 위한 바운딩 ────────────────────── */

/**
 * 씬 전체를 감싸는 축 정렬 상자. 카메라 프리셋(§5)이 이걸 보고 거리를 잡는다.
 * Z는 데이터가 아니라 **표시 범위 ZMAX로 고정**한다 — 프롬프트마다 카메라가
 * 들썩이면 모델 비교가 안 된다.
 */
export function sceneBox(c) {
  const halfX = ((c.T - 1) / 2) * c.DX + c.NODE_R;
  return {
    min: { x: -halfX, y: 0, z: -ZMAX },
    max: { x: halfX, y: c.L * c.DY, z: ZMAX },
    center: { x: 0, y: (c.L * c.DY) / 2, z: 0 },
    size: { x: 2 * halfX, y: c.L * c.DY, z: 2 * ZMAX },
  };
}

/**
 * 상자가 화면에 다 들어오는 카메라 거리 — **시선 방향을 반영한다.**
 *
 * ⚠️ 옛 구현은 가로를 항상 `size.x`, 깊이를 항상 `size.z`로 봤다. 정면에서는 맞지만
 *    **측면 프리셋(방위 90°)에서는 깊이가 X(32B에서 38.9)**여서, 카메라 쪽으로 튀어나온
 *    앞부분이 화면 위아래로 넘쳤다. 실제로 측면 뷰에서 씬이 잘렸다.
 *
 * 상자의 8개 꼭짓점을 카메라의 right·up·forward 축에 투영해 실제 반폭·반높이·반깊이를
 * 구한다. 축 정렬 상자라 이 계산이면 어떤 각도에서도 정확하다.
 *
 * @param {{center:{x,y,z}, size:{x,y,z}}} box
 * @param {number} fovDeg 수직 화각
 * @param {number} aspect w/h
 * @param {{x:number,y:number,z:number}} [dirToCam] 타깃에서 카메라로 향하는 단위 벡터.
 *        생략하면 정면(+Z)으로 본다.
 * @param {number} [margin=1.15] 여백 배율 (§5-1)
 */
export function fitDistance(box, fovDeg, aspect, dirToCam = { x: 0, y: 0, z: 1 }, margin = 1.15) {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

  const f = norm3(dirToCam);                       // 카메라 → 씬의 반대 방향
  // right = up × f. f가 up과 평행하면(정확한 조감) 다른 축으로 피한다.
  const worldUp = Math.abs(f.y) > 0.999 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const right = norm3(cross3(worldUp, f));
  const up = cross3(f, right);

  // 꼭짓점마다 **필요한 거리를 직접 푼다.**
  //   꼭짓점의 전방 거리 = d − dot(p, f)  이고, 화면에 들어오려면
  //   |가로 성분| ≤ (d − dot(p,f))·tan(hFov/2)  →  d ≥ |가로|/tan + dot(p,f)
  //
  // ⚠️ "최대 반폭"과 "최대 반깊이"를 따로 구해 더하면 **과하게 물러난다** —
  //    가장 옆으로 튀어나온 꼭짓점과 가장 앞으로 튀어나온 꼭짓점이 보통 다른 점이기
  //    때문이다. 3/4 시점에서 화면을 절반밖에 못 쓰는 원인이 이것이었다.
  const tv = Math.tan(vFov / 2);
  const th = Math.tan(hFov / 2);
  const h = { x: box.size.x / 2, y: box.size.y / 2, z: box.size.z / 2 };
  let need = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = { x: sx * h.x, y: sy * h.y, z: sz * h.z };     // 중심 기준 꼭짓점
    const fwd = dot3(p, f);
    need = Math.max(need, Math.abs(dot3(p, right)) / th + fwd);
    need = Math.max(need, Math.abs(dot3(p, up)) / tv + fwd);
  }
  return need * margin;
}

function norm3(v) {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}
function cross3(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
