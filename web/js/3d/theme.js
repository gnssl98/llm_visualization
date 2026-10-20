/**
 * theme — CSS 변수를 three.js 색·시간으로 옮긴다. 사양서 §4-3 (S-01).
 *
 * **`js/3d/` 아래에서 색을 아는 파일은 여기 하나뿐이다.** 다른 파일에 색 리터럴이
 * 1건이라도 있으면 반려다(§15-3). 이유는 취향이 아니라 유지보수다 — 토큰이
 * 2D와 공유되므로, 3D가 색을 따로 들고 있으면 팔레트를 바꿀 때 두 화면이 어긋난다.
 *
 * ⚠️ CSS 변수는 sRGB 문자열이다. three r152+는 ColorManagement가 기본 활성이라
 *    `setStyle(v, SRGBColorSpace)`로 넣지 않으면 색이 미묘하게 밝아진다.
 */
import * as THREE from 'three';

const _color = new Map();
const _ms = new Map();

function raw(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** CSS 색 변수 → THREE.Color(사본). 호출측이 마음대로 수정해도 캐시가 오염되지 않는다. */
export function cssColor(name) {
  if (!_color.has(name)) {
    const v = raw(name);
    if (!v) throw new Error(`theme: CSS 변수 ${name} 가 비어 있습니다 — tokens.css가 로드됐는지 확인`);
    _color.set(name, new THREE.Color().setStyle(v, THREE.SRGBColorSpace));
  }
  return _color.get(name).clone();
}

/**
 * 알파 대신 **배경색을 섞어** 반투명을 표현한다(§4-5).
 *
 * 진짜 알파를 쓰지 않는 이유: ① `LineMaterial`의 정점 알파 지원이 버전마다 다르다
 * ② 반투명 선끼리 그리는 순서에 따라 결과가 달라진다(정렬 문제).
 * 배경이 단색 `--paper`이므로 **눈에는 완전히 같고**, 예측 가능성만 얻는다.
 */
export function mixToPaper(c, alpha) {
  return c.clone().lerp(cssColor('--paper'), 1 - alpha);
}

/** `--t-2` 같은 시간 토큰 → ms. 접근성 설정(prefers-reduced-motion)이 0ms로 덮으면 그대로 따른다. */
export function cssMs(name) {
  if (!_ms.has(name)) {
    const v = raw(name);
    const n = parseFloat(v);
    // 단위를 확인하지 않고 parseFloat만 하면 `0.42s`가 0.42ms가 된다.
    _ms.set(name, Number.isFinite(n) ? (v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n) : 0);
  }
  return _ms.get(name);
}

/** 놀람도 순차 색 5단계 (§3-2 Emb 층 전용). 0~1을 받아 색을 고른다. */
export function seqColor(t) {
  const i = Math.max(0, Math.min(4, Math.floor(t * 5)));
  return cssColor(`--seq-${i + 1}`);
}

/**
 * 테마·팔레트가 바뀌면 캐시를 버린다.
 * 다크 모드 토글이나 tokens.css 교체 후 이걸 안 부르면 **옛 색이 그대로 남는다** —
 * 캐시가 있는 모든 것의 기본 함정이라 명시적으로 노출해 둔다.
 */
export function invalidateTheme() {
  _color.clear();
  _ms.clear();
}

/** 이 파일이 실제로 읽는 토큰 목록. 부팅 시 한 번 확인해 조용한 결손을 막는다. */
export const REQUIRED_TOKENS = [
  '--paper', '--ink', '--ink-2', '--ink-3', '--ink-4',
  '--line', '--line-strong', '--signal', '--warn',
  '--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5',
];

/**
 * 토큰이 다 있는지 확인한다. 없으면 **부팅을 멈춘다.**
 * 빠진 변수를 `new THREE.Color()`에 넘기면 검정이 되는데, 검정은 이 팔레트에서
 * 그럴듯해 보여서 아무도 눈치채지 못한 채 잘못된 화면이 나간다.
 */
export function assertTokens() {
  const missing = REQUIRED_TOKENS.filter((n) => !raw(n));
  if (missing.length) throw new Error(`theme: CSS 토큰 누락 — ${missing.join(', ')}`);
}
