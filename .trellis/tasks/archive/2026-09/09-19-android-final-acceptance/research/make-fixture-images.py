#!/usr/bin/env python3
"""FEATURE-558 · 图片查看器夹具的两张 PNG。

用法：`python3 make-fixture-images.py [输出目录]`（默认 `./fixture-images`），
生成 `probe558-a.png` / `probe558-b.png`，由 `acceptance558.sh` 拷进本地后端的
uploads 卷（容器内 `/app/data/uploads`，公开路由 `/uploads/<key>`）。

为什么是「棋盘格 + 一条彩带」：
- 棋盘格给 `image_block_bounds`（lib558.sh）一个高对比的行带，用它才能在
  uiautomator 树里没有图片节点的情况下把图片定位到像素；
- 双击缩放后视口内图案整体放大，`png_diff_ratio` 的差异占比因此远超噪声；
- 两张图的彩带颜色不同（红 / 蓝），横向翻页到第二张时一眼可辨，不依赖计数文案。

尺寸 1080×1600 与模拟器 1080×2400 同宽：图片会以接近原宽度显示，彩带落在
屏幕中部，采样点稳定。
"""

import os
import sys

from PIL import Image, ImageDraw

WIDTH = 1080
HEIGHT = 1600
CELL = 60

# 彩带颜色：A 红、B 蓝（翻页判据）
BANDS = {
    "probe558-a.png": (214, 40, 40),
    "probe558-b.png": (24, 90, 214),
}


def build(band_color):
    img = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(img)
    for y in range(0, HEIGHT, CELL):
        for x in range(0, WIDTH, CELL):
            if ((x // CELL) + (y // CELL)) % 2 == 0:
                draw.rectangle([x, y, x + CELL - 1, y + CELL - 1], fill=(18, 18, 18))
    # 彩带：屏幕中部横贯一条，缩放/翻页都能用颜色判定
    draw.rectangle([0, HEIGHT // 2 - 120, WIDTH, HEIGHT // 2 + 120], fill=band_color)
    return img


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "fixture-images"
    os.makedirs(out_dir, exist_ok=True)
    for name, color in BANDS.items():
        path = os.path.join(out_dir, name)
        build(color).save(path)
        print(f"{path} {os.path.getsize(path)}B")


if __name__ == "__main__":
    main()
