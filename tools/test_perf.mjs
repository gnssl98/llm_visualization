#!/usr/bin/env node
/** perf.js 순수 로직 회귀 — three/DOM 없이 돈다. */
import { createPerfMonitor, STAGE_NAMES } from '../web/js/3d/perf.js';

let fail = 0;
function ok(cond, label) { if (cond) console.log(`  ✓ ${label}`); else { console.log(`  ✗ ${label}`); fail++; } }

console.log('\n[§4-6] 60fps(창 미달)에서는 감축 없음');
{
  const m = createPerfMonitor();
  let fired = null;
  for (let i = 0; i < 59; i++) fired = m.frame(i * (1000 / 60)) || fired;
  ok(fired === null && m.stage === 0, '59프레임(창 미달)에서 판단 안 함');
}

console.log('\n[§4-6] 60fps 유지 시 감축 없음');
{
  const m = createPerfMonitor();
  let fired = null;
  for (let i = 0; i < 200; i++) fired = m.frame(i * (1000 / 60)) || fired;
  ok(fired === null && m.stage === 0, '60fps 200프레임 — 감축 트리거 안 됨');
}

console.log('\n[§4-6] 20fps 지속 시 4단계까지 순서대로 적용');
{
  const m = createPerfMonitor();
  const fired = [];
  let t = 0;
  // 60프레임 창을 여러 번 채운다(20fps = 50ms/frame). 매 단계 재적용 후 창을 리셋하므로
  // 충분히 긴 시퀀스를 돌려 4단계 전부 트리거되는지 본다.
  for (let i = 0; i < 60 * 6; i++) { t += 50; const f = m.frame(t); if (f) fired.push(f); }
  ok(fired.length === 4, `4단계 전부 트리거됨 (실제 ${fired.length}건)`, );
  ok(JSON.stringify(fired) === JSON.stringify(STAGE_NAMES), `순서가 명세와 일치: ${JSON.stringify(fired)}`);
  ok(m.stage === 4, '내부 stage 카운터 4에서 멈춤(더 감축할 게 없음)');
}

console.log('\n[§4-6] 감축 후 fps가 회복되면 더는 진행하지 않는다');
{
  const m = createPerfMonitor();
  let t = 0;
  for (let i = 0; i < 60; i++) { t += 50; m.frame(t); }   // 20fps로 1단계 트리거
  ok(m.stage === 1, '1단계까지만 진행');
  const before = m.stage;
  for (let i = 0; i < 200; i++) { t += 1000 / 60; m.frame(t); }   // 60fps로 회복
  ok(m.stage === before, '회복 후 추가 감축 없음(더 나빠지지 않는 한 단계 유지)');
}

console.log(fail === 0 ? '\n통과 — 전 항목\n' : `\n실패 ${fail}건\n`);
process.exit(fail ? 1 : 0);
