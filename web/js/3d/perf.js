/**
 * perf — fps 감시 · 저사양 자동 감축 판단. 사양서 §4-6, R3-43.
 *
 * "최근 60프레임 평균 < 30fps면 ①pixelRatio 1.0 ②antialias off ③노드 세그먼트 16→8
 *  ④궤적 보간 8→3분할 순으로 단계 적용"
 *
 * 이 파일은 **판단만** 한다 — pixelRatio를 실제로 바꾸거나 렌더러를 재생성하는 건
 * main.js의 일이다(labels.js·intro.js와 같은 원칙: three 자원 소유는 호출측에).
 * 그래야 "몇 fps였는지"를 순수하게 테스트할 수 있다(three 없이, `tools/test_perf.mjs`).
 */

const WINDOW = 60;
const THRESHOLD_FPS = 30;
export const STAGE_NAMES = ['pixelRatio', 'antialias', 'nodeSegments', 'trailSubdiv'];

export function createPerfMonitor() {
  const times = [];
  let stage = 0;   // 0 = 감축 없음, 1~4 = STAGE_NAMES 몇 단계까지 적용됐는지

  /**
   * 프레임이 실제로 렌더될 때만 부른다 — 정지(on-demand 미렌더) 구간을 창에
   * 섞으면 "60프레임 사이 시간"이 아니라 "60프레임 사이 유휴 시간"을 재게 된다.
   * @param {number} nowMs
   * @returns {string|null} 이번 호출에서 새로 적용해야 할 감축 단계 이름. 없으면 null.
   */
  function frame(nowMs) {
    times.push(nowMs);
    if (times.length > WINDOW) times.shift();
    if (times.length < WINDOW || stage >= STAGE_NAMES.length) return null;
    const fps = ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]);
    if (fps < THRESHOLD_FPS) {
      const name = STAGE_NAMES[stage];
      stage += 1;
      times.length = 0;   // 다음 단계 판단은 새 창으로 — 방금 적용한 감축 효과를 먼저 봐야 한다
      return name;
    }
    return null;
  }

  return { frame, get stage() { return stage; } };
}
