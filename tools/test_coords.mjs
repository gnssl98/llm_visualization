#!/usr/bin/env node
/**
 * coords.js 검증 — 사양서 §2-2 표와 숫자로 대조한다.
 *
 * **왜 브라우저 없이 도는가** — 좌표는 씬 전체가 얹히는 바닥이라 여기가 틀리면
 * 화면의 모든 것이 조용히 틀린다. 그런데 화면으로는 "좀 이상한데" 이상을 알 수 없다.
 * three.js를 import하지 않는 순수 함수로 둔 이유가 이것이다.
 *
 * 사용: node tools/test_coords.mjs
 */
import {
  DX_MAX, DX_MIN, ZMAX, ASPECT_TARGET, Z_ASPECT_TARGET, heightFor, makeCoords, clamp, dxFor,
  normalizePC1, axisWarnings, sceneBox, fitDistance,
} from '../web/js/3d/coords.js';

let fail = 0;
const near = (a, b, eps = 5e-3) => Math.abs(a - b) <= eps;
function ok(cond, label, got = '') {
  if (cond) { console.log(`  ✓ ${label}`); }
  else { console.log(`  ✗ ${label}${got ? `  → ${got}` : ''}`); fail++; }
}

console.log('\n[§2-2] 스케일 — 사양서 표와 대조');
// | L | H | DY | 24층 대비 |
for (const [L, H, DY, ratio] of [[24, 14.00, 0.583, 1.00], [40, 18.07, 0.452, 1.29], [64, 22.86, 0.357, 1.63]]) {
  const c = makeCoords(L, 10);
  ok(near(c.H, H) && near(c.DY, DY) && near(c.H / 14, ratio),
     `L=${L} → H ${H} · DY ${DY} · 비 ${ratio}`, `H ${c.H.toFixed(2)} DY ${c.DY.toFixed(3)}`);
}
// 구 사양의 버그(L=64에서 총 높이 22.4)가 되살아나지 않았는지
ok(heightFor(64) < 23 && heightFor(64) > 22, '제곱근 비례 — L=64에서 하한에 걸리지 않음', heightFor(64).toFixed(2));

console.log('\n[§2-1] X는 고정 격자 · 문장 중앙이 원점');
{
  const c = makeCoords(24, 5);
  ok(near(c.x(2), 0), 'T=5의 가운데 토큰이 x=0');
  ok(near(c.x(0), -2 * c.DX) && near(c.x(4), 2 * c.DX), '양 끝이 대칭');
  const c2 = makeCoords(24, 4);
  ok(near(c2.x(0) + c2.x(3), 0), 'T가 짝수여도 중심이 원점');
  // "고정 격자"의 뜻은 *데이터 값에 반응하지 않는다*이지 *상수*가 아니다.
  // 한 분석 안에서 간격이 완전히 균일한지를 본다.
  const big = makeCoords(64, 96);
  let uniform = true;
  for (let i = 1; i < 96; i++) if (!near(big.x(i) - big.x(i - 1), big.DX, 1e-9)) uniform = false;
  ok(uniform, '한 분석 안에서 간격이 완전히 균일');
}

console.log('\n[§2-2 v1.8] DX 억제 — 정면(X:Y)과 측면(X:Z)을 **둘 다** 억제한다');
{
  // ⚠️ v1.7까지는 "정면 종횡비를 ASPECT_TARGET에 **맞춘다**"였다. 2026-08-27 디자인
  // 리뷰에서 그 규칙만으로는 측면이 무너진다는 것이 실측으로 드러났다 — Z는 ZMAX로
  // 고정폭이라 T가 커지면 X:Z가 그대로 벌어진다(59토큰에서 10.7:1, "얇은 판자").
  // 이제 DX는 두 후보(정면 기준·측면 기준) 중 **더 좁은 쪽**이다. 따라서 정면 종횡비는
  // ASPECT_TARGET에 "맞는" 것이 아니라 그 **이하**가 된다(여백이 남는 쪽이 안전하다).
  for (const [L, T] of [[64, 96], [24, 59], [24, 96], [48, 80]]) {
    const c = makeCoords(L, T);
    const xy = ((T - 1) * c.DX) / c.H;            // 정면 종횡비
    const xz = ((T - 1) * c.DX) / (2 * ZMAX);     // 측면 종횡비
    const atFloor = near(c.DX, DX_MIN);
    ok(xy <= ASPECT_TARGET + 0.02,
       `L=${L} T=${T} → 정면 ${xy.toFixed(2)}:1 ≤ ${ASPECT_TARGET}:1`);
    ok(atFloor || xz <= Z_ASPECT_TARGET + 0.05,
       `L=${L} T=${T} → 측면 ${xz.toFixed(2)}:1 ≤ ${Z_ASPECT_TARGET}:1 (DX ${c.DX.toFixed(3)})`,
       atFloor ? 'DX_MIN 바닥이라 초과 허용' : '');
  }
  // 두 후보 중 더 좁은 쪽을 쓴다 — 어느 한쪽만 보고 고르지 않는다
  ok(near(dxFor(24, 59), Math.min((ASPECT_TARGET * heightFor(24)) / 58,
                                  (Z_ASPECT_TARGET * 2 * ZMAX) / 58)),
     'DX = min(정면 후보, 측면 후보)');
  // 짧은 문장은 예전 그대로 — 늘리지 않는다(이때는 세로 기준으로 맞춰지므로 이득이 없다)
  ok(near(makeCoords(24, 5).DX, DX_MAX), 'T=5는 DX_MAX 유지');
  ok(near(makeCoords(24, 1).DX, DX_MAX), 'T=1(단일 토큰)에서 0으로 나누지 않음');
  // 하한
  ok(dxFor(24, 100000) >= DX_MIN, '극단적으로 긴 문장도 하한 아래로 안 내려감');
  // 노드는 간격에 비례 — 좁아진 문장에서 겹치지 않아야 한다
  const c32 = makeCoords(64, 96);
  ok(2 * c32.NODE_R < c32.DX, `노드 지름 ${(2*c32.NODE_R).toFixed(3)} < 간격 ${c32.DX.toFixed(3)} — 겹치지 않음`);
  ok(c32.NODE_H > 0 && c32.NODE_H < c32.NODE_R, '원반 두께 > 0 이고 반지름보다 작음');
}

console.log('\n[§2-1] Y는 Emb(l=0)이 바닥');
{
  const c = makeCoords(24, 5);
  ok(c.y(0) === 0, 'Emb 층이 y=0');
  ok(c.y(24) > c.y(23), '위로 갈수록 커짐');
  ok(near(c.y(24), c.H), '최상단 = 총 높이');
}

console.log('\n[§2-2] Z는 표시 범위로 잘린다');
{
  const c = makeCoords(24, 5);
  ok(near(c.z(0), 0), 'pc1n=0 → z=0');
  ok(near(c.z(1), ZMAX) && near(c.z(-1), -ZMAX), '±1 → ±ZMAX');
  ok(near(c.z(9), ZMAX) && near(c.z(-9), -ZMAX), '범위 밖은 잘림(발산 방지)');
  ok(clamp(5, 0, 1) === 1 && clamp(-5, 0, 1) === 0 && clamp(0.5, 0, 1) === 0.5, 'clamp');
}

console.log('\n[§3-2] 노드 크기는 한 분석 안에서 전부 동일');
{
  const c = makeCoords(24, 5);
  ok(c.NODE_R > 0 && c.NODE_H > 0, '반지름·두께 모두 양수 (두께 0이면 정면 뷰에서 사라진다)');
  ok(c.NODE_H < c.NODE_R, '원반이다 — 두께가 반지름보다 작음');
}

console.log('\n[§2-3] 정규화는 서버 값을 나누기만 한다');
{
  const proj = {
    pc1: [[0, 50, -50], [100, -200, 25]],
    pc1_scale: 100, evr: 0.08, overflow: 2.0, method: 'postnorm',
    sign_fixed: true, squashed: 0.04, squashed_limit: 0.2,
  };
  const n = normalizePC1(proj);
  ok(near(n.pc1n[0][1], 0.5), 'scale로 나눔');
  ok(near(n.pc1n[1][1], -1), '범위 밖(-2.0)은 -1로 잘림');
  ok(n.layerOf(1) === 1, 'subsample 없으면 행 인덱스 = 층 번호');
  ok(n.evr === 0.08 && n.method === 'postnorm' && n.squashed === 0.04,
     '캡션이 읽는 값이 그대로 통과');

  const n2 = normalizePC1(proj, null, 2);
  ok(near(n2.pc1n[0][1], 0.25), '사용자 배율이 먹음');

  // 층 stride가 걸린 경우 — 행 인덱스와 층 번호가 어긋나는 지점
  const sub = { stride: 8, shown: 2, total: 65, layers: [0, 8] };
  const n3 = normalizePC1(proj, sub);
  ok(n3.layerOf(0) === 0 && n3.layerOf(1) === 8, 'subsample 시 행→층 매핑');

  // 0 나눗셈 방어 — 화면이 NaN으로 통째로 사라지는 것보다 평평한 축이 낫다
  const n4 = normalizePC1({ ...proj, pc1_scale: 0 });
  ok(n4.pc1n.flat().every(Number.isFinite), 'scale=0에서도 NaN이 나오지 않음');
}

console.log('\n[§2-3-2] 런타임 가드');
{
  const base = { squashed: 0.04, squashedLimit: 0.2, overflow: 1.2 };
  ok(axisWarnings(base).length === 0, '정상 조합은 조용하다');
  ok(axisWarnings({ ...base, squashed: 0.38 }).includes('axisSquashed'),
     'squashed 38%(1.5B 긴 프롬프트 실측)에서 경고');
  ok(axisWarnings({ ...base, squashed: 0.20 }).length === 0,
     '정확히 임계값이면 통과 — 합격선은 "≤ 20%"다');
  ok(axisWarnings({ ...base, overflow: 6 }).includes('axisOverflow'), 'overflow > 5에서 경고');
  // 임계를 서버가 내려주지 않는 옛 응답과 섞였을 때 조용히 늘 켜지면 안 된다
  ok(axisWarnings({ squashed: 0.9, squashedLimit: null, overflow: 1 }).length === 0,
     '임계가 없으면 경고하지 않음(하드코딩 금지의 부작용 방어)');
}

console.log('\n[§5] 씬 바운딩 · 카메라 거리');
{
  const c = makeCoords(64, 96);
  const box = sceneBox(c);
  ok(near(box.size.y, c.H) && near(box.center.y, c.H / 2), '세로가 총 높이');
  ok(box.size.z === 2 * ZMAX, 'Z는 데이터가 아니라 표시 범위로 고정 — 프롬프트마다 카메라가 들썩이지 않는다');
  // ⚠️ v1.7까지는 "96토큰 32B는 세로보다 가로가 길다"였다. v1.8에서 측면 억제가
  // 들어가며 DX가 하한(0.15)까지 눌려, 이제는 **세로가 더 길다**(14.3 : 22.9).
  // 그게 의도다 — 층이 64개나 되는 모델을 억지로 옆으로 눕힐 이유가 없다.
  ok(box.size.x / box.size.y < 3.0,
     `정면 종횡비 ${(box.size.x / box.size.y).toFixed(2)}:1 — 4.2:1이던 것이 억제됨`);
  ok(box.size.x / box.size.z <= Z_ASPECT_TARGET + 0.6,
     `측면 종횡비 ${(box.size.x / box.size.z).toFixed(2)}:1 — "얇은 판자" 회귀 방지 (DX 하한 여유 포함)`);

  const wide = fitDistance(box, 40, 16 / 9);
  const tall = fitDistance(box, 40, 9 / 16);
  ok(tall > wide, '세로 화면일수록 더 물러난다(가로 화각이 좁아지므로)');

  // 프리셋 3종을 실제 시선 방향으로 검산한다.
  // 옛 구현은 깊이를 항상 Z로 봐서 **측면에서 씬이 잘렸다** — 회귀로 박아 둔다.
  const dirOf = (az, el) => ({ x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: Math.cos(az) * Math.cos(el) });
  const VIEWS = [['정면', 0, 0], ['측면', Math.PI / 2, 0], ['조감', 0.489, 1.082], ['3/4', 0.559, 0.314]];
  for (const [name, az, el] of VIEWS) {
    const dir = dirOf(az, el);
    const d = fitDistance(box, 40, 16 / 9, dir);
    // 카메라 축에 상자 꼭짓점을 투영해 화면 안에 들어오는지 직접 확인
    const f = dir;
    const wu = Math.abs(f.y) > 0.999 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    const cr = (a, b) => ({ x: a.y*b.z-a.z*b.y, y: a.z*b.x-a.x*b.z, z: a.x*b.y-a.y*b.x });
    const nr = (v) => { const n = Math.hypot(v.x,v.y,v.z)||1; return {x:v.x/n,y:v.y/n,z:v.z/n}; };
    const dt = (a, b) => a.x*b.x+a.y*b.y+a.z*b.z;
    const right = nr(cr(wu, f)), up = cr(f, right);
    const vFov = (40*Math.PI)/180, hFov = 2*Math.atan(Math.tan(vFov/2)*(16/9));
    let fits = true;
    const h = { x: box.size.x/2, y: box.size.y/2, z: box.size.z/2 };
    for (const sx of [-1,1]) for (const sy of [-1,1]) for (const sz of [-1,1]) {
      const p = { x: sx*h.x, y: sy*h.y, z: sz*h.z };
      const depth = d - dt(p, f);                       // 카메라에서 이 꼭짓점까지의 전방 거리
      if (depth <= 0) { fits = false; continue; }        // 카메라 뒤에 있으면 실패
      if (Math.abs(dt(p, right)) > depth * Math.tan(hFov/2)) fits = false;
      if (Math.abs(dt(p, up))    > depth * Math.tan(vFov/2)) fits = false;
    }
    ok(fits, `${name} 시점에서 상자 8개 꼭짓점이 모두 화면 안 (거리 ${d.toFixed(1)})`);
  }
}

console.log('\n[색 리터럴] §15-3 셀프 리뷰');
{
  const src = await (await import('node:fs')).promises
    .readFile(new URL('../web/js/3d/coords.js', import.meta.url), 'utf8');
  ok(!/0x[0-9a-fA-F]{6}|#[0-9a-fA-F]{3,8}\b/.test(src), 'coords.js에 색 리터럴 없음');
  ok(!/from ['"]three/.test(src), 'coords.js가 three를 import하지 않음 (브라우저 없이 검증 가능)');
}

console.log(fail === 0 ? `\n통과 — 전 항목\n` : `\n실패 ${fail}건\n`);
process.exit(fail ? 1 : 0);
