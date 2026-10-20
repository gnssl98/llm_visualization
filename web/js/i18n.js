/* i18n.js — t(key, params) 보간 + 한국어 조사 자동 선택 + applyStrings (사양서 §7-4, §7-4-1)
   vanilla(빌드 없음)라 window 전역으로 노출한다. strings.js 다음, app.js 이전에 로드. */
"use strict";

(function () {
  /* 조사 쌍: [받침 있음, 받침 없음] */
  const JOSA = {
    "이가": ["이", "가"], "을를": ["을", "를"], "은는": ["은", "는"],
    "와과": ["과", "와"], "으로로": ["으로", "로"],
  };

  function lang() {
    const saved = localStorage.getItem("lang");
    if (saved) return saved;
    return (navigator.language || "ko").startsWith("ko") ? "ko" : "en";
  }

  /* 한글 음절이면 받침 유무, 아니면 null (영문·기호 토큰: ropertie, ?>> 등) */
  function jongseong(value) {
    const s = String(value);
    const ch = s.charAt(s.length - 1);
    const code = ch.charCodeAt(0);
    if (code < 0xAC00 || code > 0xD7A3) return null;
    return (code - 0xAC00) % 28;
  }

  function pickJosa(prevValue, pair) {
    const j = jongseong(prevValue);
    if (j === null) return JOSA[pair][1];              // 비한글 → 기본형(받침 없음형)
    if (pair === "으로로" && j === 8) return "로";      // ㄹ받침 예외
    return j !== 0 ? JOSA[pair][0] : JOSA[pair][1];
  }

  /* t('annot.attends', {q:'는', k:'수도', w:'0.42'})
     - {name} → params[name]
     - {이가} 등 조사 토큰 → 바로 앞 치환값의 받침으로 결정 (en에서는 빈 문자열)
     - 미치환 플레이스홀더가 남으면 콘솔 경고 + null 반환(렌더 생략용) */
  function t(key, params) {
    const L = lang();
    let tpl = (window.STRINGS[L] && window.STRINGS[L][key]);
    if (tpl == null) {
      tpl = window.STRINGS.ko[key];
      if (L !== "ko" && tpl != null) console.warn("[i18n] en 미번역, ko 폴백:", key);
    }
    if (tpl == null) { console.warn("[i18n] 키 없음:", key); return key; }

    let lastValue = "";
    let unresolved = false;
    const out = tpl.replace(/\{([^}]+)\}/g, (m, name) => {
      if (JOSA[name]) return L === "ko" ? pickJosa(lastValue, name) : "";
      if (params && Object.prototype.hasOwnProperty.call(params, name)) {
        lastValue = String(params[name]);
        return lastValue;
      }
      unresolved = true;
      return m;
    });
    if (unresolved) { console.warn("[i18n] 미치환 값:", key); return null; }
    return out;
  }

  /* [data-i18n="key"] → textContent, [data-i18n-attr="placeholder:key;title:key2"] → 속성 */
  function applyStrings(newLang) {
    if (newLang) localStorage.setItem("lang", newLang);
    const L = lang();
    document.documentElement.lang = L;
    const title = t("meta.title");
    if (title != null) document.title = title;
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const v = t(el.dataset.i18n);
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(el => {
      el.dataset.i18nAttr.split(";").forEach(pair => {
        const [attr, key] = pair.split(":");
        if (!attr || !key) return;
        const v = t(key.trim());
        if (v != null) el.setAttribute(attr.trim(), v);
      });
    });
  }

  window.t = t;
  window.applyStrings = applyStrings;
  window.i18nLang = lang;
})();
