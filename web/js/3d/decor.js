/**
 * decor — 층 평면 · 바닥 그리드 · 결정 깊이 선. 사양서 §3-5 / §3-6.
 *
 * 이 파일이 담는 건 "데이터"가 아니라 **공간을 읽을 수 있게 하는 기준**이다.
 * 그래서 규칙이 하나 있다 — **눈에 띄면 실패다.** 노드와 궤적이 주인공이고
 * 여기 있는 것들은 그것들이 어디 놓였는지 알려주는 역할만 한다.
 *
 * 층 평면을 **초점과 그 ±1층에만** 그리는 이유가 그것이다. 64개를 다 그리면
 * 시각 소음이 되어 정작 봐야 할 궤적을 덮는다(§3-5).
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { cssColor, mixToPaper } from './theme.js';

// §3-5 초점 층 채움 — 거의 안 보여야 한다. 2026-08-27 리뷰: 0.04라도 무대 세로
// 전체 폭(x1-x0)×깊이(z1-z0)를 덮는 큰 면이라 누적 효과로 화면 위쪽이 뿌옇게
// 흐려 보였다("안개" 느낌) — 특히 여러 프레임이 겹쳐 보이는 3/4 시점에서.
// 0.025로 더 낮춘다. 결정선(§3-6, --signal)과의 대비만 지키면 되므로 더 죽여도 된다.
const PLANE_ALPHA = 0.025;
const MARGIN_RATIO = 0.6;      // 노드 바운딩 바깥 여백 (× DX)
const GRID_DROP = 0.8;         // 바닥 그리드는 Emb 층 아래 이만큼 (× DY)
const GRID_Z_LINES = 5;        // Z방향 분할
const DECISION_PX = 1.5;       // §3-6 결정 기준선 굵기(화면 단위)
/**
 * 결정 기준선 색의 채도. 1이면 --signal 그대로(순정 보라).
 *
 * ⚠️ 2026-08-27 리뷰: `focusLayer`는 처음에 `decisionDepth`와 같은 값으로 시작한다
 * (main.js) — 즉 흔한 초기 상태에서 **결정선과 초점 테두리가 같은 y에 겹쳐 그려진다.**
 * 게다가 토큰 라벨은 그 y보다 `NODE_R*3`만 위에 뜨는데, `decisionDepth`가 최상단
 * 근처면(§15-4 판정 기준 화면들에서 흔함) 위로 뺄 여유 공간이 거의 없어 순정 --signal
 * 사각 테두리가 라벨 줄과 시각적으로 부딪힌다(실측: "The"·"…ce" 라벨이 결정선 테두리
 * 위에 얹혀 보였다). 라벨 위치는 건드리지 않는다 — 그러면 다른 배치가 깨질 수 있다.
 * 대신 이 선 자체를 **--paper 쪽으로 살짝 죽여서** 부딪혀도 서로 안 싸우게 한다.
 * opacity(0→1 페이드 인)는 그대로 두고 색만 낮춘다 — 등장 연출 타이밍은 안 건드린다.
 */
const DECISION_TINT = 0.6;

export function buildDecor(c, size = { w: 1, h: 1 }) {
  const group = new THREE.Group();
  group.name = 'decor';
  const margin = MARGIN_RATIO * c.DX;
  const x0 = c.x(0) - c.NODE_R - margin;
  const x1 = c.x(c.T - 1) + c.NODE_R + margin;
  const z0 = -c.ZMAX - margin;
  const z1 = c.ZMAX + margin;

  /* ── 초점 층 평면 (채움 1개) ───────────────────────── */
  // XZ에 눕힌다. PlaneGeometry는 XY 평면에 생기므로 -90° 회전.
  const planeGeo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  planeGeo.rotateX(-Math.PI / 2);
  const planeMat = new THREE.MeshBasicMaterial({
    color: mixToPaper(cssColor('--ink'), PLANE_ALPHA),
    // 평면이 노드보다 앞에 그려져 노드를 지우는 것을 막는다. 깊이는 읽되 쓰지 않는다.
    depthWrite: false,
    side: THREE.DoubleSide,
    // §8-1 등장 시퀀스가 700~1100ms에 페이드 인 시키려고 실제 투명도가 필요하다.
    // 색 자체는 이미 mixToPaper로 --paper 쪽에 살짝만 섞어 둔 값이라, 여기 opacity는
    // 그 위에 곱해지는 등장 연출 전용 배율이다(평소엔 1).
    transparent: true, opacity: 1,
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  plane.renderOrder = -1;                    // 항상 먼저 그린다
  plane.visible = false;
  group.add(plane);

  /* ── 초점 ±1 테두리 (선 1배치) ─────────────────────── */
  // 초점은 --line-strong, ±1은 --line. 색이 다르므로 정점 색으로 한 배치에 담는다.
  const borderGeo = new THREE.BufferGeometry();
  const BORDER_SEGS = 3 * 4;                 // 사각형 3개 × 변 4개
  const bPos = new Float32Array(BORDER_SEGS * 2 * 3);
  const bCol = new Float32Array(BORDER_SEGS * 2 * 3);
  borderGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  borderGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
  const borders = new THREE.LineSegments(
    borderGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
  borders.frustumCulled = false;
  group.add(borders);

  /* ── 바닥 그리드 ───────────────────────────────────── */
  // GridHelper는 쓰지 않는다 — 기본 색·분할이 규격 밖이라 토큰과 무관한 격자가 생긴다(§3-5).
  const gy = -GRID_DROP * c.DY;
  const gPts = [];
  for (let i = 0; i < c.T; i++) { const gx = c.x(i); gPts.push(gx, gy, z0, gx, gy, z1); }
  for (let k = 0; k < GRID_Z_LINES; k++) {
    const gz = z0 + ((z1 - z0) * k) / (GRID_Z_LINES - 1);
    gPts.push(x0, gy, gz, x1, gy, gz);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPts, 3));
  const gridMat = new THREE.LineBasicMaterial({ color: cssColor('--line') });
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  grid.frustumCulled = false;
  group.add(grid);

  /* ── 결정 깊이 기준선 (§3-6) ───────────────────────── */
  // 굵기 1.5px를 주려면 화면 단위 재질이어야 한다 — LineBasicMaterial.linewidth는
  // 대부분의 WebGL 환경에서 무시되어 항상 1px로 나온다(§4-5).
  const decGeo = new LineSegmentsGeometry();
  decGeo.setPositions(rectSegments(x0, x1, z0, z1, 0));
  const decMat = new LineMaterial({
    color: mixToPaper(cssColor('--signal'), DECISION_TINT), linewidth: DECISION_PX,
    worldUnits: false, dashed: false,
    transparent: true, opacity: 1,   // §8-1: 900~1400ms 페이드 인용
  });
  decMat.resolution.set(size.w, size.h);
  const decision = new LineSegments2(decGeo, decMat);
  decision.frustumCulled = false;
  decision.visible = false;
  group.add(decision);

  const api = {
    group, decisionLine: decision,

    /** 초점 층과 그 ±1의 평면·테두리를 놓는다. */
    setFocus(l) {
      const yc = c.y(l);
      plane.position.y = yc;
      plane.visible = true;

      const strong = cssColor('--line-strong');
      const faint = cssColor('--line');
      let s = 0;
      const put = (y, col) => {
        const r = rectSegments(x0, x1, z0, z1, y);
        for (let k = 0; k < r.length; k++) bPos[s * 3 + k] = r[k];
        for (let v = 0; v < 8; v++) {          // 사각형 = 선분 4개 = 정점 8개
          bCol[(s + v) * 3] = col.r; bCol[(s + v) * 3 + 1] = col.g; bCol[(s + v) * 3 + 2] = col.b;
        }
        s += 8;
      };
      put(yc, strong);
      // ±1층은 테두리만. 범위를 벗어나면 그 자리에 겹쳐 두어 보이지 않게 한다.
      put(l - 1 >= 0 ? c.y(l - 1) : yc, l - 1 >= 0 ? faint : strong);
      put(l + 1 <= c.L ? c.y(l + 1) : yc, l + 1 <= c.L ? faint : strong);
      borderGeo.attributes.position.needsUpdate = true;
      borderGeo.attributes.color.needsUpdate = true;
    },

    /**
     * 결정 깊이 기준선. `null`이면 **그리지 않는다.**
     * 결정 깊이가 없다는 건 "마지막 층에서야 답이 정해졌다"는 뜻이고,
     * 그때 선을 그리면 화면에 없는 사건을 있다고 말하는 셈이 된다(§3-6 케이스 B).
     * 그 경우의 안내 문구는 DOM이 담당한다.
     */
    setDecision(d) {
      if (d == null) { decision.visible = false; return; }
      decGeo.setPositions(rectSegments(x0, x1, z0, z1, c.y(d)));
      decision.visible = true;
    },

    /**
     * ⚠️ **리사이즈마다 반드시 부른다.** `LineMaterial`은 화면 픽셀 굵기를 계산하려고
     * 해상도를 알아야 한다. 빠뜨리면 창 크기에 따라 굵기가 틀어진다(§15-3 체크 항목).
     */
    setResolution(w, h) { decMat.resolution.set(w, h); },

    /** §8-1 등장 시퀀스 전용. p=0이면 안 보이고 1이면 평소 밝기(0.04*mixToPaper). */
    setPlaneOpacity(p) { planeMat.opacity = p; },
    /** p=0~1. `setDecision(null)`로 애초에 안 보이는 상태면 이건 아무 효과가 없다
     *  (visible=false가 opacity보다 우선한다 — three.js가 그렇게 그린다). */
    setDecisionOpacity(p) { decMat.opacity = p; },

    dispose() {
      planeGeo.dispose(); planeMat.dispose();
      borderGeo.dispose(); borders.material.dispose();
      gridGeo.dispose(); gridMat.dispose();
      decGeo.dispose(); decMat.dispose();
    },
  };
  return api;
}

/** y 높이의 사각 윤곽을 선분 4개(정점 8개)의 평평한 배열로. */
function rectSegments(x0, x1, z0, z1, y) {
  return [
    x0, y, z0, x1, y, z0,
    x1, y, z0, x1, y, z1,
    x1, y, z1, x0, y, z1,
    x0, y, z1, x0, y, z0,
  ];
}
