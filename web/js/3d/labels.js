/**
 * labels — DOM 라벨 오버레이. 사양서 §6-1, §6-2.
 *
 * **3D 공간에 텍스트를 그리지 않는다.** 전부 캔버스 위에 얹은 DOM이다 —
 * 선명도·복사 가능·스크린리더·폰트 일관성을 한 번에 얻는다(§6 서두).
 *
 * 이 파일은 순수 DOM 조작만 한다. **three는 import하지 않는다** — `project()`가
 * 반환한 벡터(x,y,z)만 받아 화면 좌표로 바꾸는 게 이 파일의 일이고, `Vector3`
 * 자체를 만드는 건 호출측(main.js)이 한다.
 */

const MAX_LABELS = 24;      // §6-2
const MAX_LABELS_SHRUNK = 10;
const MOVE_THRESHOLD = 0.5; // px — 이 미만이면 DOM 쓰기를 건너뛴다(§6-1)
const COLLIDE_PX = 18;      // 같은 축(세로)에서 이 이내로 겹치면 낮은 우선순위를 숨긴다

/**
 * @param {HTMLElement} container `.labels` — `position:relative`인 무대 안, `pointer-events:none`
 */
export function createLabelLayer(container) {
  const pool = new Map();   // key -> {el, lastX, lastY}

  function acquire(key, cls) {
    let e = pool.get(key);
    if (!e) {
      const el = document.createElement('span');
      el.className = cls;
      container.appendChild(el);
      // -Infinity로 시작한다. NaN으로 시작하면 첫 갱신에서 `Math.abs(NaN - sx) >= 임계값`이
      // 항상 false라 아무 좌표도 안 써서 라벨이 전부 (0,0)에 쌓이는 버그가 났다 — 실측으로 확인.
      e = { el, lastX: -Infinity, lastY: -Infinity };
      pool.set(key, e);
    }
    return e;
  }

  function release(key) {
    const e = pool.get(key);
    if (e) { e.el.remove(); pool.delete(key); }
  }

  function releaseAllExcept(keepKeys) {
    for (const key of [...pool.keys()]) if (!keepKeys.has(key)) release(key);
  }

  /**
   * 라벨 후보 목록을 받아 화면에 반영한다.
   *
   * @param {Array<{key:string, cls:string, text:string, sx:number, sy:number,
   *                visible:boolean, priority:number}>} items
   *   sx,sy는 §6-1 공식으로 이미 계산된 화면 픽셀 좌표. visible=false면 프러스텀 밖.
   * @param {boolean} shrunk 무대 축소 상태(§5-4) — 상한을 10으로 낮춘다.
   */
  function update(items, shrunk = false) {
    const cap = shrunk ? MAX_LABELS_SHRUNK : MAX_LABELS;

    // 우선순위 오름차순(낮은 숫자 = 높은 우선) 정렬 후 화면 밖·초과분 제외.
    const visible = items.filter((it) => it.visible).sort((a, b) => a.priority - b.priority);

    // 세로 축 충돌 회피: 이미 채택된 라벨과 18px 이내면 낮은 우선순위(뒤에 온 것) 숨김.
    // 밀어내지 않는다 — 밀어내면 라벨이 매 프레임 자리를 바꿔 더 산만하다(§6-2).
    const kept = [];
    for (const it of visible) {
      if (kept.length >= cap) break;
      const collide = kept.some((k) => Math.abs(k.sy - it.sy) < COLLIDE_PX && Math.abs(k.sx - it.sx) < COLLIDE_PX * 3);
      if (!collide) kept.push(it);
    }

    const keepKeys = new Set(kept.map((it) => it.key));
    releaseAllExcept(keepKeys);

    for (const it of kept) {
      const e = acquire(it.key, it.cls);
      if (e.el.textContent !== it.text) e.el.textContent = it.text;
      if (Math.abs(e.lastX - it.sx) >= MOVE_THRESHOLD || Math.abs(e.lastY - it.sy) >= MOVE_THRESHOLD) {
        e.el.style.transform = `translate3d(${it.sx.toFixed(1)}px, ${it.sy.toFixed(1)}px, 0)`;
        e.lastX = it.sx; e.lastY = it.sy;
      }
    }
    return { shown: kept.length, dropped: visible.length - kept.length };
  }

  function dispose() { releaseAllExcept(new Set()); }

  return { update, dispose };
}

/**
 * 월드 좌표 → 화면 픽셀. 사양서 §6-1 공식 그대로.
 * @param {{x:number,y:number,z:number}} worldPos three.Vector3와 덕타이핑 호환
 * @param {THREE.Camera} camera
 * @param {{width:number, height:number}} rect 캔버스 클라이언트 사각형
 */
export function project(worldPos, camera, rect) {
  const v = worldPos.clone().project(camera);
  const sx = (v.x * 0.5 + 0.5) * rect.width;
  const sy = (-v.y * 0.5 + 0.5) * rect.height;
  const visible = v.z < 1 && sx > -40 && sx < rect.width + 40 && sy > -20 && sy < rect.height + 20;
  return { sx, sy, visible };
}
