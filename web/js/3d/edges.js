/**
 * edges — attention 엣지 (초점 층만). 사양서 §3-4.
 *
 * 층을 바꿀 때마다 **전부 다시 만든다.** 노드·궤적과 달리 부분 갱신을 하지 않는다 —
 * 초점 층이 바뀌면 엣지 집합 자체가 완전히 다른 데이터라 재사용할 게 없다.
 * 예산은 §4-6 "16ms 이내"다.
 *
 * `w`(가중치, 0~1) 정규화는 **서버가 이미 끝냈다**(`panels._prune_attention`,
 * sink 제외·대각선 제외). 여기서는 그 값을 그리기만 한다 — 다시 계산하지 않는다.
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { cssColor, mixToPaper } from './theme.js';
// bucketOf/WIDTH_BUCKETS는 별도 파일이다 — three를 import하지 않아 Node에서
// 브라우저 없이 검증할 수 있다(`tools/test_edges.mjs`). coords.js와 같은 이유다.
import { WIDTH_BUCKETS, bucketOf } from './edges-math.js';

const ARC_SEGMENTS = 16;                  // §3-4: 16분할
const SINK_PX = 1.5;
const SINK_DASH = 0.14, SINK_GAP = 0.10;   // §3-4 (월드 단위 — 곡선 길이 스케일과 같은 단위계)

/**
 * query q, key k의 아치형 곡선. §3-4 부풀림 공식 그대로.
 *
 * ⚠️ 끝점은 **노드의 실제 위치**다 — `z(l,q)`·`z(l,k)`는 그 층 그 토큰의
 * PC1 좌표이지 0이 아니다(사양서 원문 그대로). 엣지가 노드에서 시작해
 * 노드로 끝나야 "정보가 어디서 어디로 갔다"가 시각적으로 성립한다.
 * `zRow`는 그 층의 정규화된 PC1 행(`norm.pc1n[row]`)이다 — 호출측이 layer→row를
 * 해석해서 넘긴다(서브샘플 시 행 인덱스 ≠ 층 번호이므로, §2-3의 `layerOf`와 대칭).
 */
function edgeCurve(c, q, k, l, zRow) {
  const p0 = new THREE.Vector3(c.x(q), c.y(l), c.z(zRow[q]));
  const p1 = new THREE.Vector3(c.x(k), c.y(l), c.z(zRow[k]));
  const span = Math.abs(c.x(q) - c.x(k)) / c.DX;
  const mid = p0.clone().lerp(p1, 0.5);
  // ⚠️ 2026-08-27 리뷰: 부풀림을 `c.DX`에 비례시키면, 토큰이 많아 DX가 눌릴수록
  // (§2-2 v1.8 종횡비 수정 이후 특히 그렇다 — 59토큰에서 DX가 거의 절반으로 줄었다)
  // 아치들이 서로 겹치기 딱 좋은 순간에 오히려 더 납작해진다 — 실측(59토큰,
  // 574개 엣지 동시 표시)에서 초점 층 바로 위에 "검은 낙서"로 뭉쳤다. 부풀림은
  // 대신 `c.ZMAX`(토큰 수와 무관하게 고정된 깊이 예산)를 기준으로 잡는다 — 엣지가
  // 많을 때일수록 오히려 더 퍼져야 서로 덜 겹친다.
  mid.z -= c.ZMAX * (0.11 + 0.035 * Math.min(span, 4));
  mid.y -= Math.min(0.18 * c.DX, 0.45 * c.DY);
  const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
  return curve.getPoints(ARC_SEGMENTS);            // 17점 = 16세그먼트
}

/** 폴리라인 점 목록 → LineSegmentsGeometry용 세그먼트 쌍 배열(각 세그먼트 시작·끝 반복). */
function toSegments(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push(points[i].x, points[i].y, points[i].z, points[i + 1].x, points[i + 1].y, points[i + 1].z);
  }
  return out;
}

/**
 * @param {object} c makeCoords() 결과
 * @param {number[]} zRow 초점 층의 정규화 PC1 행 (길이 T) — 노드와 같은 좌표를 쓰기 위함
 * @param {{layer:number, edges:Array<{q:number,k:number,w:number,sink?:boolean}>}} resp
 * @param {{w:number,h:number}} size 리사이즈 대응용 초기 해상도
 */
export function buildEdges(c, zRow, resp, size) {
  const group = new THREE.Group();
  group.name = 'attention-edges';   // 디버깅·테스트가 decor의 다른 LineSegments2와 구분하는 용도
  const ink = cssColor('--ink');
  const ink4 = cssColor('--ink-4');

  // §15-3: "한 화면에 시그널 색 대상이 2개 이상이면 반려" — 엣지는 시그널을 쓰지 않는다.
  const regular = resp.edges.filter((e) => !e.sink);
  const sinks = resp.edges.filter((e) => e.sink);

  const buckets = [[], [], [], []];
  for (const e of regular) buckets[bucketOf(e.w)].push(e);

  const parts = [];   // dispose용

  buckets.forEach((list, bi) => {
    if (!list.length) return;
    const pos = [], col = [];
    for (const e of list) {
      const pts = edgeCurve(c, e.q, e.k, resp.layer, zRow);
      pos.push(...toSegments(pts));
      const cc = mixToPaper(ink, 0.10 + e.w * 0.80);   // §3-4: 알파가 연속값을 담당
      const nSeg = pts.length - 1;
      for (let s = 0; s < nSeg; s++) { col.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b); }
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    geo.setColors(col);
    const mat = new LineMaterial({
      vertexColors: true, worldUnits: false, linewidth: WIDTH_BUCKETS[bi], dashed: false,
    });
    mat.resolution.set(size.w, size.h);
    const mesh = new LineSegments2(geo, mat);
    mesh.frustumCulled = false;
    // §7-2 피킹용 역참조. LineSegments2.raycast()는 `faceIndex`로 세그먼트 인덱스를 주는데,
    // 그건 배치 안에서 몇 번째 **세그먼트**인지일 뿐 몇 번째 **엣지**인지가 아니다.
    // 엣지 하나가 ARC_SEGMENTS(16)개 세그먼트로 쪼개져 순서대로 들어갔으므로 나눗셈으로 되돌린다.
    mesh.userData.edgeAt = (hit) => list[Math.floor(hit.faceIndex / ARC_SEGMENTS)];
    group.add(mesh);
    parts.push({ geo, mat });
  });

  if (sinks.length) {
    const pos = [];
    for (const e of sinks) pos.push(...toSegments(edgeCurve(c, e.q, e.k, resp.layer, zRow)));
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    const mat = new LineMaterial({
      color: mixToPaper(ink4, 1.0), worldUnits: false, linewidth: SINK_PX,
      dashed: true, dashSize: SINK_DASH, gapSize: SINK_GAP,
    });
    mat.resolution.set(size.w, size.h);
    const mesh = new LineSegments2(geo, mat);
    mesh.computeLineDistances();       // dashed 필수 — 빠뜨리면 실선으로 나온다(§4-5)
    mesh.frustumCulled = false;
    mesh.userData.edgeAt = (hit) => sinks[Math.floor(hit.faceIndex / ARC_SEGMENTS)];
    group.add(mesh);
    parts.push({ geo, mat });
  }

  return {
    group, layer: resp.layer, count: resp.edges.length, dropped: resp.pruned?.dropped ?? 0,
    setResolution(w, h) { for (const { mat } of parts) mat.resolution.set(w, h); },
    dispose() { for (const { geo, mat } of parts) { geo.dispose(); mat.dispose(); } },
  };
}
