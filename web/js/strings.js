/* strings.js — 사용자 대면 문자열 사전 (사양서 §7-4)
   키: 화면.영역.요소[.변형]. 값의 카피 자체는 각 화면 Phase(3~5)에서 §7-2 표대로 갱신한다.
   (Phase 1은 구조 분리가 목표 — 현재 화면의 문자열을 그대로 옮긴다.)
   빌드 스텝 없는 vanilla이므로 window 전역으로 노출한다.

   ⚠️ 이 파일은 Part2_2Dvisualization_v2/web/js/strings.js를 **그대로 복사**한 것이다
   (3D 사양서 §15-1: "3D 키 추가"). 2D 전용 키(landing.*, panels.* 등)는 지금 3D 화면에서
   안 쓰지만 지우지 않는다 — annot.attends/annot.sink처럼 **그대로 재사용하는 키**가 섞여
   있고, 두 파일을 갈라두면 나중에 어느 게 원본인지 헷갈린다. 3D 전용 키는 맨 끝
   "3D 전용" 구역에 몰아 뒀다. */
"use strict";

window.STRINGS = {
  ko: {
    "meta.title": "LLM 2D 시각화 — 언어 모델의 내부를 봅니다",

    /* ---- 랜딩 ---- */
    "landing.eyebrow": "LLM 2D VISUALIZATION",
    "landing.h1.1": "블랙박스를,",
    "landing.h1.2": "들여다볼 수 있는 ",
    "landing.h1.em": "유리 상자",
    "landing.h1.3": "로",
    "landing.lede.1": "프롬프트 하나를 입력하면 — 문장이 토큰으로 분해되고, 층을 지나며 의미가 만들어지고, 다음 단어가 확률로 선택되는 ",
    "landing.lede.b": "모든 과정",
    "landing.lede.2": "을 보여드립니다.",
    "landing.input.ph": "프롬프트를 입력하세요 — 예: 대한민국의 수도는",
    "landing.cta": "들여다보기",
    "landing.examples.label": "예시로 시작",
    "landing.ex.1": "The capital of France is",
    "landing.ex.2": "대한민국의 수도는",
    "landing.ex.3": "Once upon a time, there was a",
    "landing.ex.4": "1 + 1 =",
    "landing.howto.title": "How to use",
    "landing.howto.1.t": "프롬프트 입력",
    "landing.howto.1.d": "문장을 넣으면 모델이 추론 1회를 수행하고, 그 안에서 일어난 모든 내부 신호를 캡처합니다.",
    "landing.howto.2.t": "Layer 흐름",
    "landing.howto.2.d": "토큰이 임베딩 → N개의 층 → 출력 확률로 변해가는 전 과정을 층별 카드로 탐색합니다. 각 층이 \"지금 생각하는 단어\"도 보입니다.",
    "landing.howto.3.t": "토큰 벡터",
    "landing.howto.3.d": "각 단어가 실제로 어떤 숫자 벡터인지, 임베딩 공간에서 어떤 단어들과 가까운지, 층을 지나며 어디로 이동하는지 봅니다.",
    "landing.howto.4.t": "전체 패널",
    "landing.howto.4.d": "surprisal 히트맵·attention·확신 게이지 등 9개 진단 패널을 교육/실무 렌즈로 골라 봅니다.",
    "landing.howto.note": "모델: 기본 소형(실시간) — 상단에서 다른 HuggingFace 모델로 전환 가능 (첫 로드는 수 분).",

    /* ---- 공통 ---- */
    "footer.project": "LLM 3D 시각화 플랫폼 · Step 2 (2D MVP)",
    "footer.credit": "경기청년 갭이어 프로그램의 지원을 받아 제작되었습니다",
    "brand.name": "LLM 2D 시각화",
    "brand.home": "처음 화면으로",

    /* ---- 앱 셸 ---- */
    "app.tab.flow": "Layer 흐름",
    "app.tab.vectors": "토큰 벡터",
    "app.tab.panels": "전체 패널",
    "app.analyze": "분석",
    "app.model.custom": "직접 입력 (HF repo id)…",
    "app.model.customPrompt": "HuggingFace repo id 입력 (예: Qwen/Qwen2.5-1.5B)",

    /* ---- 상태 줄 (동적) ---- */
    "status.analyzing": "분석 중 — 모델이 아직 로드 전이면 로드부터 합니다 (소형: 수 초, 대형: 수 분)…",
    "status.done": "완료 — {repo} · {n} tokens · {layers} layers · {sec}s",
    "status.truncated": " (길이 상한으로 잘림)",
    "status.loading": "\"{repo}\" 로드 중 — 첫 로드는 다운로드 포함 수 분 걸릴 수 있습니다…",
    "status.loaded": "\"{repo}\" 로드 완료",
    "status.failed": "요청 실패: {msg}",
    "status.connFailed": "서버 연결 실패: {msg}",

    /* ---- 탭1 흐름 ---- */
    "flow.title": "Transformer 흐름 — 토큰이 답이 되기까지",
    "flow.desc.1": "토큰 → Embedding → Transformer 블록 ×N → 다음 토큰 확률. 블록 하나를 펼쳐 attention(곡선)과 MLP를 봅니다. ",
    "flow.desc.b": "토큰 행에 마우스를 올리면",
    "flow.desc.2": " 그 토큰이 어느 토큰을 보는지 곡선이 강조됩니다.",
    "flow.stepper.label": "블록 선택:",
    "flow.caption": "곡선의 진하기 = attention 가중치 · ◆ = 답이 확정되는 블록(결정 깊이)",
    "flow.badge.final": "최종 예측 \"{tok}\"",
    "flow.badge.depth": "결정 깊이 {d} / L{last}",
    "flow.badge.entropy": "엔트로피 {v} bits",
    "flow.badge.unreliableModel": "⚠ 이 모델은 중간층 예측(logit-lens) 신뢰 불가 — 아키텍처 특성",
    "flow.badge.lateDecision": "이 프롬프트는 마지막 층에서야 답 확정 — 중간층 예측은 참고용",
    "flow.detail.title.emb": "Embedding 층",
    "flow.detail.title.block": "L{l} 블록 상세",
    "flow.detail.cap.emb": "토큰이 벡터가 되는 층 — 아직 문맥이 섞이지 않았습니다. 위 다이어그램의 행에 마우스를 올리면 그 토큰의 벡터가 아래에 열립니다.",
    "flow.detail.cap.block": "attention으로 다른 토큰의 정보를 모으고, MLP로 계산한 뒤의 상태입니다.",
    "flow.detail.sub.attn": "attention (헤드 평균) — 세로 query · 가로 key",
    "flow.detail.sub.emb": "hover 중인 토큰의 임베딩 벡터",
    "flow.detail.sub.lens": "이 층의 위치별 중간 예측 (logit-lens)",
    "flow.stat.norm": "활성 norm ‖h‖ = {v}",
    "flow.stat.cos": "이전 층과 cos = {v}",
    "flow.stat.attn": "attention entropy = {v} bits · sink 질량 = {s}",
    "flow.stat.act": "최대 활성 |act| = {v} (중앙값 대비 {r}×)",
    "flow.fullvec.title": "\"{tok}\" — 실제 임베딩 벡터 {d}차원 원본값",
    "flow.fullvec.cap": "이 단어가 모델 안에서 실제로 갖는 숫자 전부입니다 — 위는 전체 파형(차원당 1픽셀), 아래는 원본값 목록(차원 번호: 값).",

    /* ---- 탭2 벡터 ---- */
    "vec.pick.title": "토큰을 선택하세요",
    "vec.pick.cap": "각 단어(토큰)는 모델 안에서 수백~수천 개 숫자의 벡터입니다. 클릭해서 들여다보세요.",
    "vec.dims.title": "\"{tok}\" — {d}차원 벡터",
    "vec.dims.cap": "임베딩 벡터의 각 차원 값 (파랑 −, 빨강 +). 이 숫자들이 이 단어의 \"의미 좌표\"입니다.",
    "vec.dims.stats": "‖v‖ = {norm} · 표시: {d}차원 중 {shown}개 샘플(간격 {stride}) · 값은 최대절댓값 기준 정규화",
    "vec.nn.title": "임베딩 공간에서 가까운 단어",
    "vec.nn.cap": "전체 어휘 중 이 벡터와 cosine 유사도가 가장 높은 토큰 — \"의미가 거리로 보인다\".",
    "vec.traj.title": "층을 지나며 이동하는 경로",
    "vec.traj.cap": "이 토큰의 표현이 임베딩(L0)에서 마지막 층까지 2D 투영 공간에서 움직인 궤적.",
    "vec.map.title": "모든 토큰의 임베딩 지도",
    "vec.map.cap": "프롬프트 전체 토큰의 임베딩 2D 투영. 선택한 토큰이 강조됩니다.",

    /* ---- 탭3 패널 ---- */
    "panels.lens.label": "렌즈:",
    "panels.lens.edu": "교육",
    "panels.lens.pro": "실무",
    "panels.lens.all": "전체",
    "panels.p1.t": "① 입력 — 문장이 분해되는 순간",
    "panels.p1.d": "프롬프트가 모델이 읽는 토큰 조각으로 나뉩니다.",
    "panels.p2.t": "② surprisal — 모델이 놀란 곳",
    "panels.p2.d": "색이 붉을수록 모델이 예상 못 한 토큰. 커서를 올리면 bits.",
    "panels.p3.t": "③ 다음 토큰 — 답이 선택되는 순간",
    "panels.p3.d": "후보 top-5와 확신도.",
    "panels.p4.t": "④ attention — 정보가 흐르는 경로",
    "panels.p4.d": "0번 열이 밝으면 attention sink.",
    "panels.p4.layer": "층",
    "panels.p4.head": "헤드",
    "panels.p4.headMean": "평균",
    "panels.p5.t": "⑤ 공간 — 의미가 거리로 보인다",
    "panels.p5.d": "층 슬라이더를 움직이면 표현이 이동합니다 (등방성 교정).",
    "panels.p5.layer": "층",
    "panels.p5.trail": "궤적",
    "panels.p6.t": "⑥ logit-lens — 층마다 무엇을 생각하나",
    "panels.p6.d": "최종 답과 같아지는 층 = 결정 깊이.",
    "panels.p7.t": "⑦ 층별 진단 — norm 성장 · 표현 변화",
    "panels.p7.d": "층별 활성 크기(선), 인접 층 유사도(점선).",
    "panels.p8.t": "⑧ 토큰 비용 — 같은 말, 다른 값",
    "panels.p8.d": "언어별 토큰 수 = API 비용·컨텍스트 소모.",
    "panels.p9.t": "⑨ massive activation — 양자화 취약점",
    "panels.p9.d": "층별 최대 활성/중앙값 비율.",

    /* ---- 동적 문장 (조사 처리 예) ---- */
    "annot.attends": "'{q}'{이가} '{k}'{을를} 가장 많이 봅니다 ({w})",
    "annot.sink": "'{q}'{은는} {sink}를 첫 토큰에 쏟습니다 — 내용을 보는 게 아니라 쉬어가는 자리입니다(attention sink). 나머지 중에서는 '{k}'{을를} 가장 많이 봅니다 ({share}).",

    /* ---- 3D 전용 (사양서 §6-4, §3-6, §2-3-2) ---- */
    "d3.decision.reached": "L{d}에서 답이 정해집니다",
    "d3.decision.unreached": "답이 마지막 층에서야 정해졌습니다",
    "d3.axis.squashed": "이 모델·문장에서는 앞뒤 축이 잘 퍼지지 않습니다 — 의미 이동을 과소평가할 수 있습니다.",
    "d3.axis.overflow": "일부 값이 표시 범위를 크게 넘습니다.",
    "d3.band1.title": "{l} 안에서 일어난 일",   // l에 이미 층 라벨(Emb 또는 L23)이 온다
    "d3.band2.title.selected": "'{tok}' — 이 토큰의 숫자",
    "d3.band2.title.default": "마지막 토큰의 숫자",
    "d3.edge.weight": "'{q}' → '{k}' · 가중치 {w}",
    // 2D의 annot.attends/annot.sink는 실제로 쓰인 적 없는 미검증 스캐폴딩이라
    // ({sink} 자리표시자의 의미가 불명확) 그대로 재사용하지 않고 3D 전용으로 새로 쓴다.
    "d3.annot.attends": "'{q}'{이가} '{k}'{을를} 가장 많이 봅니다 ({w})",
    "d3.annot.sink": "'{q}'{은는} 첫 토큰에 주의를 쏟습니다 — 내용을 보는 게 아니라 쉬어가는 자리입니다(attention sink). 나머지 중에서는 '{k}'{을를} 가장 많이 봅니다 ({w}).",
  },

  /* en 사전은 Phase 6에서 채운다 (§7-4: 직역 금지, 키 구조는 동일) */
  en: {},
};
