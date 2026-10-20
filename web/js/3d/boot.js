/**
 * boot — 페이지 배선. 씬 자체는 main.js가 안다.
 *
 * 데이터 소스가 둘이다.
 *   ① `?api=` — 실제 서버(`/api/analyze`, `/api/attention?layer=L`)
 *   ② 기본    — `fixtures/`의 저장된 응답. **서버 없이 씬을 검증하기 위해서다.**
 * 픽스처 경로를 남겨두는 이유는 단계 4~7에서 씬을 고칠 때마다 GPU 포드를 켜는 것이
 * 비현실적이기 때문이다. 응답 스키마는 계약 테스트가 지키므로 픽스처가 낡을 위험은 낮다.
 *
 * attention 지연 로드(T3-2, §5-2)는 `/api/attention?layer=L`을 그대로 부른다 —
 * 실서버 모드와 완전히 같은 URL 패턴이라 나중에 바꿀 코드가 없다. 픽스처 모드에서는
 * `python tools/dev_stage_server.py`가 같은 경로를 흉내 낸다(실제 프루닝 함수를
 * 그대로 호출한다 — 재구현이 아니다). `python -m http.server`로 띄우면 이 요청만 404가
 * 나고 엣지가 안 보인다 — 그게 의도된 동작이다(정적 서버는 쿼리스트링을 못 받는다).
 */
import { createStage } from './main.js';
import { createRail } from './rail.js';
import { webglOk, watchContextLoss } from './webgl.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
// 2026-08-27 디자인 리뷰: 상태 줄이 "노드 1,440 · draw call 3 · squashed 12%"처럼
// 개발자 전용 수치를 그대로 사용자에게 보여주고 있었다 — §12 톤 규칙("모든 수치
// 옆에 의미 문장 1줄")을 어긴다. 개발 수치는 `?debug=1`일 때만 덧붙인다.
const DEBUG = q.get('debug') === '1';

/**
 * §10-3 (F-20, F-21, R3-40). WebGL이 아예 없으면 `createStage()`를 부르지 않는다 —
 * `new THREE.WebGLRenderer()`가 그 안에서 던지므로, 감지를 먼저 해야 페이지 전체가
 * 죽는 걸 막는다. **평면 모드 자체(2D UI로 실제 전환)는 단계 10의 일**이다 — 사양서
 * 스테이지 표에도 R3-41이 단계 10에 따로 배정돼 있다. 지금은 "3D를 못 켠다"는 사실을
 * 정직하게 보여주고 죽지 않는 것까지가 이 단계의 몫이다.
 */
function showWebglUnavailable() {
  const w = $('webglWarn');
  w.textContent = '이 브라우저에서는 3D를 쓸 수 없어 평면으로 보여드립니다.';
  w.classList.remove('hidden');
  $('empty').textContent = '평면 모드는 준비 중입니다 (단계 10) — 지금은 3D만 지원합니다.';
  $('stage').style.display = 'none';
  document.querySelector('.bar').style.display = 'none';
}

if (!webglOk()) {
  showWebglUnavailable();
  // 이 파일의 나머지는 전부 stage(3D)를 전제하므로 여기서 멈춘다.
  throw new Error('[webgl] 미지원 — 3D 부트 중단, 평면 안내로 대체');
}

const api = q.get('api');
const fixtureParam = q.get('fixture') || './fixtures/qwen05b.json';
// dev_stage_server가 찾는 이름 — 확장자·경로를 뗀 기본 이름.
const attnFixtureName = q.get('attnFixture') || fixtureParam.replace(/^.*\//, '').replace(/\.json$/, '');

/**
 * attention 지연 로드 URL. 세 가지 모드를 지원한다.
 *
 *   ① `?api=...`  — 실제 분석 서버(`/api/attention?layer=L`)
 *   ② `?dev=1`    — 로컬 개발 서버(tools/dev_stage_server.py). 서버가 실제 프루닝
 *                   함수를 그때그때 호출하므로 픽스처를 새로 만들어도 즉시 반영된다.
 *   ③ 기본값      — **미리 덤프해 둔 정적 파일**(`fixtures/attn/<이름>_L<층>.json`).
 *                   이 모드 덕분에 GitHub Pages 같은 정적 호스팅에서 서버 없이도
 *                   attention 엣지까지 전부 동작한다. 덤프는 `tools/dump_attention.py`가 만든다.
 */
const attentionUrl = api
  ? (idx) => `${api.replace(/\/$/, '')}/api/attention?layer=${idx}`
  : q.get('dev') === '1'
    ? (idx) => `/api/attention?layer=${idx}&fixture=${encodeURIComponent(attnFixtureName)}`
    : (idx) => `./fixtures/attn/${encodeURIComponent(attnFixtureName)}_L${idx}.json`;

const stage = createStage($('scene'), $('stage'), { attentionUrl });
let ctx = null;

// §10-3 (F-21): 런타임 컨텍스트 손실 → 평면 안내로 전환. 복구 재시도는 watchContextLoss가
// 이미 1회로 막는다. 여기서는 "평면 모드 자체가 아직 없다"는 같은 정직한 안내를 쓴다.
watchContextLoss($('scene'), () => {
  stage.dispose();
  showWebglUnavailable();
});

/* §9-3 층 레일. 2026-08-27부터 층 선택의 유일한 UI다(슬라이더 제거, 사용자 승인) —
   토큰 선택은 3D 피킹(§7-2)이 맡는다. 둘 다 stage.setState로 수렴하고, 키보드
   접근성(화살표·Tab·Enter·Esc)은 main.js가 캔버스에 직접 건 전역 핸들러가 담당하므로
   폼 컨트롤이 없어도 그대로 유지된다. */
const rail = createRail($('rail'));
rail.onPick = (l) => stage.setState({ focusLayer: l });

/* 시점 프리셋 */
function selectPreset(name) {
  document.querySelectorAll('[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.preset === name)));
  stage.applyPreset(name);
}
document.querySelectorAll('[data-preset]').forEach((b) => {
  b.addEventListener('click', () => selectPreset(b.dataset.preset));
});
// 사용자가 직접 돌리면 프리셋 활성 표시를 뗀다 — 지금 보이는 구도가 그 프리셋이 아니므로.
stage.controls.addEventListener('start', () => {
  document.querySelectorAll('[data-preset]').forEach((o) => o.setAttribute('aria-pressed', 'false'));
});
// §7-1 키보드 프리셋(1/2/3). 슬라이더 등 폼 컨트롤에 포커스가 있으면 물러난다 —
// main.js의 키 핸들러와 같은 가드다(중복이지만 각자 자기 UI 책임만 진다).
window.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  if (ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
  const map = { '1': 'front', '2': 'side', '3': 'top' };
  if (map[e.key]) { selectPreset(map[e.key]); e.preventDefault(); }
});

let DATA = null;

/* 데이터 */
async function load() {
  const url = api ? `${api.replace(/\/$/, '')}/api/analyze` : fixtureParam;
  let data;
  try {
    if (api) {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: q.get('prompt') || '한국어 조사 처리는 토크나이저마다 크게 다르다.' }),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      data = await r.json();
    } else {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`픽스처를 찾을 수 없습니다: ${url}`);
      data = await r.json();
    }
  } catch (e) {
    $('empty').textContent = `불러오지 못했습니다 — ${e.message}`;
    return;
  }

  DATA = data;
  ctx = stage.setData(data);
  $('empty').classList.add('hidden');

  // 캡션은 evr·method를 **항상** 적는다. 축 하나가 의미의 전부인 척하지 않는다(§2-3-2).
  const pct = (v) => `${Math.round(v * 100)}%`;
  $('caption').textContent =
    `의미 축 (PC1 · 분산 ${pct(ctx.norm.evr)} · ${ctx.norm.method})` +
    ` · ${data.model.repo} · 층 ${data.model.n_layers} · 토큰 ${data.model.seq}` +
    (ctx.subsample ? ` · ${ctx.subsample.stride}층 간격으로 표시` : '');

  // 런타임 가드. 문구는 여기 두지만 단계 6에서 i18n(§12)으로 옮긴다.
  const MSG = {
    axisSquashed: '이 모델·문장에서는 앞뒤 축이 잘 퍼지지 않습니다 — 의미 이동을 과소평가할 수 있습니다.',
    axisOverflow: '일부 값이 표시 범위를 크게 넘습니다.',
  };
  const warn = $('axisWarn');
  warn.textContent = ctx.warnings.map((k) => MSG[k]).join(' ');
  warn.classList.toggle('hidden', ctx.warnings.length === 0);

  const L = data.model.n_layers;
  const initialFocus = data.logit_lens?.decision_depth ?? L;

  const decision = data.logit_lens?.reliable ? data.logit_lens.decision_depth : null;
  rail.setLayers(L, decision, data.logit_lens?.top1_prob ?? null);
  rail.setFocus(initialFocus);
  renderGridTable(data);   // A-05 대체 뷰

  // 상태 줄 — §12 톤 규칙: 수치 하나도 맨몸으로 보여주지 않는다, 옆에 뜻을 적는다.
  // `dev` 조각(노드 수·draw call·squashed%)은 `?debug=1`에서만 붙는다.
  let statAttnText = '';
  let statDegradeText = '';   // 저사양 자동 감축 — 사용자가 알아야 할 일이라 debug 무관하게 남긴다
  function renderStat() {
    const parts = [statAttnText];
    if (DEBUG) {
      // draw call은 **한 프레임 그린 뒤**에야 의미가 있다. renderer.info.render는 매
      // 렌더마다 초기화되므로 setData 직후 읽으면 항상 0이다(실제로 그렇게 나온 적 있음) —
      // 그래서 dev 조각은 rAF 두 번 뒤에 값이 채워진다(아래 최초 호출부).
      parts.push(`[dev] 노드 ${(ctx.norm.rows * data.model.seq).toLocaleString()}` +
        ` · draw call ${stage.info.calls} · squashed ${pct(ctx.norm.squashed)}`);
    }
    if (statDegradeText) parts.push(statDegradeText);
    $('stat').textContent = parts.filter(Boolean).join(' · ');
  }
  requestAnimationFrame(() => requestAnimationFrame(renderStat));

  // attention은 지연 로드라 도착이 늦다 — 응답이 반영될 때마다 별도로 갱신한다.
  // dropped(생략된 약한 연결 수)만이 일반 사용자에게 의미가 있는 정보라 기본 문장에 남긴다.
  stage.onAttention = (edgeInfo) => {
    statAttnText = !edgeInfo
      ? '이 층에는 이을 attention이 없습니다 (Embedding).'
      : edgeInfo.dropped > 0
        ? `약한 연결 ${edgeInfo.dropped.toLocaleString()}개는 화면이 복잡해지지 않도록 생략했습니다.`
        : '이 층의 attention을 모두 표시했습니다.';
    renderStat();
    renderAttnTable(edgeInfo);
  };

  /**
   * A-05 대체 뷰. **3D를 전혀 안 보고도** 같은 사실(층별 예측·attention)에
   * 닿을 수 있어야 한다는 게 요구의 핵심이라, 여기서 별도로 좌표·픽킹 없이
   * 순수 데이터(문자열·숫자)만으로 표를 짠다.
   */
  function renderGridTable(data) {
    const grid = data.logit_lens?.grid, positions = data.logit_lens?.grid_positions;
    const tbl = $('gridTable');
    if (!grid || !positions) { tbl.innerHTML = '<tr><td>이 분석에는 층×위치 표가 없습니다.</td></tr>'; return; }
    const decision = data.logit_lens?.reliable ? data.logit_lens.decision_depth : null;
    const head = '<tr><th>층</th>' + positions.map((p) => {
      const tok = data.tokens?.[p]?.text ?? String(p);
      return `<th>${escapeHtml(tok)}</th>`;
    }).join('') + '</tr>';
    const rows = grid.map((row, l) => {
      const label = l === 0 ? 'Emb' : `L${l - 1}`;
      const cls = l === decision ? ' class="decision"' : '';
      return `<tr><td${cls}>${label}</td>` + row.map((tok) => `<td>${escapeHtml(tok)}</td>`).join('') + '</tr>';
    }).join('');
    tbl.innerHTML = head + rows;
  }

  function renderAttnTable(edgeInfo) {
    const tbl = $('attnTable');
    if (!edgeInfo || !edgeInfo.edges) { tbl.innerHTML = '<tr><td>이 층에는 attention이 없습니다(Embedding).</td></tr>'; return; }
    const label = (i) => DATA?.tokens?.[i]?.text ?? String(i);
    const sorted = [...edgeInfo.edges].sort((a, b) => a.q - b.q || b.w - a.w);
    const head = '<tr><th>query</th><th>key</th><th>가중치</th></tr>';
    const rows = sorted.map((e) =>
      `<tr><td>${escapeHtml(label(e.q))}</td><td class="${e.sink ? 'sink' : ''}">${escapeHtml(label(e.k))}</td><td>${e.w.toFixed(2)}</td></tr>`
    ).join('');
    tbl.innerHTML = head + rows;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // R3-43(§4-6): 자동 감축이 일어나면 조용히 넘어가지 않는다 — 상태 줄에 남긴다.
  stage.onDegrade = (name, level) => {
    statDegradeText = `⚠ 화면이 매끄럽지 않아 품질을 낮췄습니다(${level}/4단계: ${name}).`;
    renderStat();
  };
}

load();

/* §7-3 상태 ↔ 아래 밴드 연동. 무대에서 무엇을 봤는지가 밴드 제목에 즉시 반영된다.
   내용(패널)은 단계 9의 일이라 제목만 갱신한다 — 지금은 그 연동 자체를 시험하는 것. */
/** A-04: 씬 요약. "{T}개 토큰이 {L}개 층을 지나는 3차원 도표. {d}번째 층에서 답 '{tok}'이 정해집니다." */
function sceneSummary(data, st) {
  const T = data.model.seq, L = data.model.n_layers;
  const base = `${T}개 토큰이 ${L}개 층을 지나는 3차원 도표.`;
  if (st.decisionDepth == null) return `${base} 답이 마지막 층에서야 정해졌습니다.`;
  return `${base} ${st.decisionDepth}번째 층에서 답 '${data.logit_lens?.final_token ?? '?'}'이 정해집니다.`;
}

stage.onStateChange = (st) => {
  if (DATA) $('scene').setAttribute('aria-label', sceneSummary(DATA, st));
  $('band1Title').textContent = t('d3.band1.title', { l: st.focusLayer === 0 ? 'Emb' : `L${st.focusLayer - 1}` });
  const tok = st.selectedToken != null ? (DATA?.tokens?.[st.selectedToken]?.text ?? String(st.selectedToken)) : null;
  $('band2Title').textContent = tok != null
    ? t('d3.band2.title.selected', { tok })
    : t('d3.band2.title.default');

  // 레일은 유일한 층 컨트롤이라 그냥 상태를 그대로 반영한다 — 슬라이더 시절에 있던
  // "두 컨트롤이 서로의 낡은 값을 되먹임하는" 문제 자체가 이제 구조적으로 없다.
  rail.setFocus(st.focusLayer);
};

/* §5-4 sticky shrink. 스크롤에 **직접** 연동한다 — --t-* 트랜지션을 쓰면 손가락에서 벗어난다.
   position:sticky는 처음부터 걸어 둔다(스크롤 0에서는 자연스레 아무 효과가 없다).
   높이만 스크롤 0~320px 구간에서 75vh→36vh로 선형 보간한다. */
$('stage').classList.add('stage--sticky');
const SHRINK_RANGE = 320;
let shrinkRaf = 0;
function applyShrink() {
  shrinkRaf = 0;
  const t01 = Math.max(0, Math.min(1, window.scrollY / SHRINK_RANGE));
  const vh = window.innerHeight;
  $('stage').style.height = `${(0.75 - 0.39 * t01) * vh}px`;
  const wasShrunk = $('stage').dataset.shrunk === '1';
  const isShrunk = t01 >= 1;
  if (wasShrunk !== isShrunk) {
    $('stage').dataset.shrunk = isShrunk ? '1' : '0';
    stage.setShrink(isShrunk);   // §6-2: 라벨 상한 24 → 10
    rail.setShrunk(isShrunk);    // §9-3: 축 모드 라벨 6개 → 3개
  }
  // ⚠️ userAdjusted면 아무것도 안 한다 — 남의 손을 밀치지 않는다(§5-4).
  stage.refit();
}
window.addEventListener('scroll', () => { if (!shrinkRaf) shrinkRaf = requestAnimationFrame(applyShrink); }, { passive: true });
applyShrink();   // 초기 상태(스크롤 0) 반영

// 테마 전환(다크 모드 등)에 캐시를 버린다. 안 하면 옛 색이 그대로 남는다.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => stage.onThemeChange());

// 개발 중 확인용 — 하네스(`perf_runner.mjs`)가 이 핸들로 상태를 읽는다.
window.__stage = stage;
window.__ready = { revision: null };
import('three').then((T) => { window.__ready = { revision: T.REVISION }; });
