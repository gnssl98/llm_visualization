#!/usr/bin/env node
/**
 * edges.js 순수 로직 회귀 — 굵기 4단계 양자화(§4-5). three/DOM 없이 돈다.
 *
 * 이 파일은 굵기를 **연속값(w)에서 4단계로 스냅**하는 유일한 산술이다.
 * 사양서 공식(0.6 + w*3.2px)과 4단계 배열이 여기서 만나는데, 둘 중 하나만
 * 손대도 매핑이 조용히 어긋날 수 있어 숫자로 고정해 둔다.
 */
import { bucketOf, WIDTH_BUCKETS } from '../web/js/3d/edges-math.js';

let fail = 0;
function ok(cond, label) { if (cond) console.log(`  ✓ ${label}`); else { console.log(`  ✗ ${label}`); fail++; } }

console.log('\n[§4-5] w → 굵기 버킷');
ok(WIDTH_BUCKETS.length === 4, '4단계');
ok(bucketOf(0) === 0, 'w=0 → 최소 굵기(1.0px에 가장 가까움 — 0.6px)');
ok(bucketOf(1) === 3, 'w=1 → 최대 굵기(3.8px에 가장 가까움 — 3.8px)');
// 중간값들이 단조 증가하는지 — 가중치가 클수록 굵기 인덱스가 줄어들면 안 된다
let last = -1, monotone = true;
for (let w = 0; w <= 1; w += 0.05) { const b = bucketOf(w); if (b < last) monotone = false; last = b; }
ok(monotone, 'w 증가에 따라 버킷이 단조 증가(역전 없음)');
// 경계 부근 — 공식 0.6+w*3.2가 각 버킷 중앙값과 가장 가까운 지점에서 스냅되는지
ok(bucketOf(0.44) === 1, 'w=0.44 (0.6+w*3.2≈2.01px) → 버킷1(1.8px)');
ok(bucketOf(0.7) === 2, 'w=0.7 (0.6+w*3.2≈2.84px) → 버킷2(2.8px)');

console.log(fail === 0 ? '\n통과 — 전 항목\n' : `\n실패 ${fail}건\n`);
process.exit(fail ? 1 : 0);
