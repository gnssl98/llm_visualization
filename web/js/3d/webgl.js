/**
 * webgl — 지원 감지 + 컨텍스트 손실 복구. 사양서 §10-3 (F-20, F-21).
 *
 * three를 import하지 않는다 — **3D를 만들 수 있는지 만들기 전에** 판단해야 하므로
 * three 로드 자체보다 먼저 실행되어야 하고, 그래서 순수 canvas API만 쓴다.
 */

export function webglOk() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    return gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 2048;
  } catch {
    return false;
  }
}

/**
 * `webglcontextlost` 이벤트를 감시해 평면 모드로 전환한다. **복구 시도는 1회만**(§10-3)
 * — 반복 실패하는 GPU 컨텍스트에 계속 재시도하면 사용자만 기다리게 된다.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {(reason:string)=>void} onLost 손실 시 1회 호출. 호출측이 평면 모드 전환 +
 *        안내 문구 표시를 담당한다(이 모듈은 감지만 한다).
 */
export function watchContextLoss(canvas, onLost) {
  let firedOnce = false;
  const handler = (e) => {
    e.preventDefault();   // 브라우저 기본 동작(페이지 새로고침 유도 등) 대신 우리가 처리한다
    if (firedOnce) return;   // 복구 시도는 1회만 — 반복 손실이면 그대로 평면 모드에 머문다
    firedOnce = true;
    onLost('webglcontextlost');
  };
  canvas.addEventListener('webglcontextlost', handler, false);
  return () => canvas.removeEventListener('webglcontextlost', handler, false);
}
