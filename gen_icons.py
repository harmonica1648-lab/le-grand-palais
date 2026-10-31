#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_icons.py — 產生 Le Grand Palais PWA 所需的所有圖示 (PNG / ICO)

用法：
    pip install pillow
    python gen_icons.py              # 輸出到 ./icons/
    python gen_icons.py --out assets # 指定輸出資料夾

產出：
    icon-72/96/128/144/152/192/384/512.png   一般圖示 (purpose: any，圓角透明底)
    maskable-192.png / maskable-512.png      可遮罩圖示 (purpose: maskable，滿版、內容在安全區內)
    apple-touch-icon.png (180x180)           iOS 主畫面圖示 (滿版不透明)
    favicon-32.png / favicon.ico             瀏覽器分頁圖示
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageOps

# ── 品牌色 (與 index.html 的 Tailwind 設定一致) ──────────────
DARK_TOP = "#1c1f26"      # dark-800
DARK_BOTTOM = "#0b0c0e"   # dark-950
GOLD_LIGHT = "#f3e5ab"    # gold-300
GOLD_MID = "#d4af37"      # gold-400
GOLD_DARK = "#aa823d"     # gold-600

SS = 4  # 超取樣倍率 (反鋸齒)


def vertical_gradient(size, top, bottom, mid=None):
    """產生由上到下的漸層 RGB 影像。"""
    grad = Image.linear_gradient("L").resize((size, size), Image.BILINEAR)
    grad = ImageOps.invert(grad)  # 上亮下暗
    kwargs = {"black": bottom, "white": top}
    if mid:
        kwargs["mid"] = mid
    return ImageOps.colorize(grad, **kwargs)


def crown_mask(size, scale):
    """繪製皇冠遮罩 (白色 = 皇冠)。scale = 皇冠寬度佔整張圖的比例。"""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)

    # 皇冠設計座標系：100 x 100，置中放置
    box = size * scale
    ox = (size - box) / 2
    oy = (size - box) / 2 + box * 0.04  # 視覺重心微調

    def p(x, y):
        return (ox + x / 100 * box, oy + y / 100 * box)

    # 皇冠主體
    body = [p(14, 72), p(14, 34), p(34, 54), p(50, 24), p(66, 54), p(86, 34), p(86, 72)]
    d.polygon(body, fill=255)

    # 底座
    d.rounded_rectangle([p(14, 78), p(86, 88)], radius=box * 0.03, fill=255)

    # 三個頂端圓珠
    r = box * 0.055
    for cx, cy in [(14, 30), (50, 20), (86, 30)]:
        x, y = p(cx, cy)
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)

    # 主體上的三顆小寶石 (鏤空)
    gr = box * 0.03
    for cx, cy in [(32, 66), (50, 62), (68, 66)]:
        x, y = p(cx, cy)
        d.ellipse([x - gr, y - gr, x + gr, y + gr], fill=0)

    return mask


def make_icon(px, maskable=False, opaque=False):
    """
    px        輸出尺寸 (px)
    maskable  True → 滿版背景、內容縮小在安全區內 (Android 自適應圖示)
    opaque    True → 滿版不透明、不畫外框 (iOS apple-touch-icon)
    其餘      → 圓角透明底 (purpose: any)
    """
    size = px * SS
    full_bleed = maskable or opaque

    bg = vertical_gradient(size, DARK_TOP, DARK_BOTTOM).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    if full_bleed:
        canvas.paste(bg, (0, 0))
    else:
        radius = int(size * 0.22)
        rr = Image.new("L", (size, size), 0)
        ImageDraw.Draw(rr).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        canvas.paste(bg, (0, 0), rr)

        # 金色細框
        ring = Image.new("L", (size, size), 0)
        inset = int(size * 0.035)
        ImageDraw.Draw(ring).rounded_rectangle(
            [inset, inset, size - 1 - inset, size - 1 - inset],
            radius=radius - inset,
            outline=255,
            width=max(2, int(size * 0.012)),
        )
        gold_ring = vertical_gradient(size, GOLD_LIGHT, GOLD_DARK, GOLD_MID).convert("RGBA")
        canvas.paste(gold_ring, (0, 0), ring)

    # 皇冠 (金色漸層)
    scale = 0.50 if maskable else (0.56 if not opaque else 0.58)
    mask = crown_mask(size, scale)
    gold = vertical_gradient(size, GOLD_LIGHT, GOLD_DARK, GOLD_MID).convert("RGBA")
    canvas.paste(gold, (0, 0), mask)

    return canvas.resize((px, px), Image.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description="Generate PWA icons")
    parser.add_argument(
        "--out",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons"),
        help="輸出資料夾 (預設：./icons)",
    )
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)

    jobs = []

    # purpose: any
    for s in (72, 96, 128, 144, 152, 192, 384, 512):
        jobs.append((f"icon-{s}.png", make_icon(s)))

    # purpose: maskable
    for s in (192, 512):
        jobs.append((f"maskable-{s}.png", make_icon(s, maskable=True)))

    # iOS / favicon
    jobs.append(("apple-touch-icon.png", make_icon(180, opaque=True)))
    jobs.append(("favicon-32.png", make_icon(32)))

    for name, img in jobs:
        path = os.path.join(args.out, name)
        img.save(path, optimize=True)
        print(f"✔ {path}  ({img.width}x{img.height})")

    # favicon.ico (多尺寸)
    ico_path = os.path.join(args.out, "favicon.ico")
    make_icon(64).save(ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print(f"✔ {ico_path}")

    print("\n完成！共產生 %d 個檔案。" % (len(jobs) + 1))


if __name__ == "__main__":
    main()
