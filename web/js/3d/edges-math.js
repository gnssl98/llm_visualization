/**
 * edges-math — 엣지 굵기 양자화의 순수 산술만 떼어 둔 파일. 사양서 §4-5.
 *
 * `edges.js`는 three를 import해야 해서 Node에서 바로 검증할 수 없다
 * (coords.js가 three 미의존으로 설계된 것과 같은 이유). 이 파일 하나만
 * three와 무관하게 두어 `tools/test_edges.mjs`가 브라우저 없이 돈다.
 */
export const WIDTH_BUCKETS = [1.0, 1.8, 2.8, 3.8];  // §4-5: 굵기 4단계(픽셀)

/** `w`(0~1) → 4단계 중 가장 가까운 굵기 인덱스. 연속값은 알파가 담당한다(§3-4). */
export function bucketOf(w) {
  const px = 0.6 + w * 3.2;
  let best = 0, bd = Infinity;
  for (let i = 0; i < WIDTH_BUCKETS.length; i++) {
    const d = Math.abs(px - WIDTH_BUCKETS[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
