#!/usr/bin/env python3
"""Renders Sip's PNG icons (needs Pillow). Run from anywhere: python3 tools/make_icons.py
The geometry mirrors web/icon.svg."""
import math, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
SS = 4  # supersampling

def cubic(p0, p1, p2, p3, n=60):
    pts = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        pts.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
                    u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
    return pts

def drop_points():
    # 512 box: tip (256,92), belly circle centre (256,312) r124
    left = cubic((256, 92), (222, 138), (132, 226), (132, 312))
    arc = [(256 + 124*math.cos(math.radians(a)), 312 + 124*math.sin(math.radians(a))) for a in range(180, -1, -2)]
    right = cubic((380, 312), (380, 226), (290, 138), (256, 92))
    return left + arc + right

def wave_points():
    pts = [(x, 322 + 13*math.sin(2*math.pi*(x - 132)/165)) for x in range(120, 393, 2)]
    return pts + [(392, 450), (120, 450)]

def render(size, scale=1.0, rounded=True, bg=True, mono=False):
    S = size * SS
    k = S / 512
    def tf(pts):
        return [((x - 256)*scale*k + S/2, (y - 264)*scale*k + S/2) for x, y in pts]
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    if bg:
        grad = Image.new('RGBA', (S, S))
        px = grad.load()
        top, bot = (20, 104, 124), (8, 42, 52)
        for y in range(S):
            for x in range(S):
                t = min(1, max(0, (x*0.35 + y*0.9) / (S*1.1)))
                px[x, y] = tuple(round(top[i] + (bot[i]-top[i])*t) for i in range(3)) + (255,)
        mask = Image.new('L', (S, S), 0)
        r = round(S*0.225) if rounded else 0
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S-1, S-1], radius=r, fill=255)
        img.paste(grad, (0, 0), mask)
    drop = Image.new('L', (S, S), 0)
    ImageDraw.Draw(drop).polygon(tf(drop_points()), fill=255)
    if mono:
        img.paste((255, 255, 255, 255), (0, 0), drop)
    else:
        img.paste((246, 251, 250, 255), (0, 0), drop)
        wave = Image.new('L', (S, S), 0)
        ImageDraw.Draw(wave).polygon(tf(wave_points()), fill=255)
        from PIL import ImageChops
        img.paste((73, 191, 200, 255), (0, 0), ImageChops.multiply(wave, drop))
    return img.resize((size, size), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
render(192).save(os.path.join(OUT, 'icon-192.png'))
render(512).save(os.path.join(OUT, 'icon-512.png'))
render(192, scale=0.72, rounded=False).save(os.path.join(OUT, 'maskable-192.png'))
render(512, scale=0.72, rounded=False).save(os.path.join(OUT, 'maskable-512.png'))
render(180, scale=0.86, rounded=False).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
render(32).save(os.path.join(OUT, 'favicon-32.png'))
render(96, scale=1.25, bg=False, mono=True).save(os.path.join(OUT, 'badge-96.png'))
print('icons written to', os.path.normpath(OUT))
