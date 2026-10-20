/**
 * picking — 레이캐스트. 사양서 §7-2.
 *
 * 노드가 작아(반지름 5px 안팎) `Raycaster.intersectObject`의 기하 판정만으로는
 * 맞추기 어렵다. **화면 공간 최근접 탐색**으로 보완한다 — 투영된 노드 중심과
 * 포인터 거리가 14px 이내인 것 중 카메라에 가장 가까운 것을 고른다.
 */
import * as THREE from 'three';

const NODE_HIT_PX = 14;
const EDGE_HIT_PX = 6;

/**
 * @param {object} nodesObj buildNodes() 결과 (mesh, rows, T, rowOf, tokenOf)
 * @param {object} c makeCoords() 결과 — 노드 중심 좌표를 다시 계산하는 데 쓴다
 * @param {(row:number)=>number} layerOf
 * @param {number[][]} pc1n
 * @param {THREE.Camera} camera
 * @param {{width:number,height:number}} rect
 * @param {number} px 포인터의 화면 좌표
 * @param {number} py
 * @returns {{row:number, token:number, layer:number}|null}
 */
export function pickNode(nodesObj, c, layerOf, pc1n, camera, rect, px, py) {
  const v = new THREE.Vector3();
  let best = null, bestDist = NODE_HIT_PX, bestDepth = Infinity;
  for (let r = 0; r < nodesObj.rows; r++) {
    const l = layerOf(r);
    const y = c.y(l);
    for (let i = 0; i < nodesObj.T; i++) {
      v.set(c.x(i), y, c.z(pc1n[r][i])).project(camera);
      if (v.z > 1 || v.z < -1) continue;                 // 카메라 뒤/클립 밖
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d <= bestDist && v.z < bestDepth) { best = { row: r, token: i, layer: l }; bestDist = d; bestDepth = v.z; }
    }
  }
  return best;
}

/**
 * attention 엣지 피킹. `LineSegments2`는 자체 raycast를 지원하므로 그걸 쓰되,
 * `threshold`(픽셀 단위 판정 폭)를 6px로 맞춘다(§7-2).
 *
 * @param {THREE.Group} edgesGroup buildEdges() 결과의 `.group` (자식이 LineSegments2들)
 * @param {THREE.Raycaster} raycaster
 * @param {THREE.Camera} camera
 * @param {number} nx NDC x (-1~1)
 * @param {number} ny NDC y (-1~1)
 * @returns {{q:number,k:number,w:number,sink?:boolean}|null}
 */
export function pickEdge(edgesGroup, raycaster, camera, nx, ny) {
  if (!edgesGroup) return null;
  raycaster.params.Line2 = { threshold: EDGE_HIT_PX };
  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  const hits = raycaster.intersectObjects(edgesGroup.children, false);
  if (!hits.length) return null;
  const obj = hits[0].object;
  return obj.userData?.edgeAt ? obj.userData.edgeAt(hits[0]) : null;
}
