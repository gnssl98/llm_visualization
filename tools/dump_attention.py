#!/usr/bin/env python3
"""픽스처의 attention을 층별 정적 JSON으로 덤프한다.

**왜 필요한가** — 3D 화면은 층을 바꿀 때마다 그 층의 attention을 따로 불러온다.
원래는 서버가 `/api/attention?layer=L` 요청을 받아 프루닝 함수를 그때 돌렸다.
정적 호스팅(GitHub Pages 등)에는 그 서버가 없으므로, 같은 응답을 미리 파일로
구워 둔다. `web/js/3d/boot.js`가 기본 모드에서 이 파일들을 직접 읽는다.

프루닝은 **재구현하지 않고** 분석 서버의 `panels._prune_attention`을 그대로 부른다.
두 경로가 다른 값을 내면 "서버에서는 되는데 정적에서는 다르다"가 되어 버린다.

사용 (이 저장소는 프론트만 담고 있으므로, 분석 엔진이 있는 환경에서 실행):
    python tools/dump_attention.py --engine-root /path/to/engine-repo

출력: web/fixtures/attn/<픽스처이름>_L<층번호>.json
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(HERE, "web", "fixtures")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine-root", required=True,
                    help="panels.py / engine.py 가 있는 분석 엔진 저장소 경로")
    ap.add_argument("--names", nargs="*", default=["qwen05b", "synthetic32b"],
                    help="덤프할 픽스처 이름(확장자 제외)")
    a = ap.parse_args()

    sys.path[:0] = [os.path.join(a.engine_root, "Part2_2Dvisualization_v2", "server"),
                    os.path.join(a.engine_root, "Part1_Parameter", "param_engine")]
    import torch
    import panels

    out = os.path.join(FIXTURES, "attn")
    os.makedirs(out, exist_ok=True)

    for name in a.names:
        # 실측 픽스처는 attention_mean을 본체에 갖고 있고, 합성 픽스처는
        # 용량 때문에 `<이름>.attn.json` 사이드카로 떨어져 있다.
        direct = os.path.join(FIXTURES, f"{name}.json")
        sidecar = os.path.join(FIXTURES, f"{name}.attn.json")
        src = sidecar if os.path.exists(sidecar) else direct
        if not os.path.exists(src):
            print(f"  건너뜀 — 원본 없음: {name}", file=sys.stderr)
            continue

        am = json.load(open(src, encoding="utf-8")).get("attention_mean")
        if am is None:
            print(f"  건너뜀 — attention_mean 없음: {src}", file=sys.stderr)
            continue

        for i, layer in enumerate(am):
            r = panels._prune_attention(torch.tensor(layer))
            r["layer"] = i
            r["pruned"] = {"k": panels.ATTN_TOPK,
                           "threshold": panels.ATTN_THRESHOLD,
                           "dropped": r.pop("dropped")}
            r["n_layers"] = len(am)
            with open(os.path.join(out, f"{name}_L{i}.json"), "w") as f:
                json.dump(r, f, separators=(",", ":"))
        print(f"  {name}: {len(am)}개 층")


if __name__ == "__main__":
    main()
