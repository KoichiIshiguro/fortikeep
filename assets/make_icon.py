#!/usr/bin/env python3
"""FortiKeep app icon generator (pure PIL, no SVG delegate needed).

Motif: rounded-square (macOS style) with an indigo-blue gradient,
a white shield (VPN / protection) and a green heartbeat pulse
(keepalive — "keep the connection alive").
"""
import os
from PIL import Image, ImageDraw, ImageFilter

S = 2048           # supersample working size
OUT = 1024         # final size
HERE = os.path.dirname(os.path.abspath(__file__))

# --- colors ---
TOP = (94, 147, 255)     # #5e93ff
BOT = (47, 73, 196)      # #2f49c4
SHIELD = (255, 255, 255)
PULSE = (38, 222, 129)   # #26de81

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

# --- canvas + vertical gradient ---
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    gd.line([(0, y), (S, y)], fill=lerp(TOP, BOT, y / S) + (255,))

# rounded-square mask (squircle-ish)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
img.paste(grad, (0, 0), mask)

# very subtle top glow (no hard glossy band — keep it flat/modern)
sheen = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(sheen)
sd.ellipse([-S * 0.4, -S * 1.25, S * 1.4, S * 0.12], fill=(255, 255, 255, 26))
sheen = sheen.filter(ImageFilter.GaussianBlur(120))
sheen = Image.composite(sheen, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask)
img = Image.alpha_composite(img, sheen)

# --- shield ---
shield = [
    (1024, 470),
    (1180, 500), (1340, 540), (1430, 566),
    (1470, 600),
    (1470, 980),
    (1460, 1140), (1380, 1320), (1230, 1470), (1024, 1610),
    (818, 1470), (668, 1320), (588, 1140), (578, 980),
    (578, 600),
    (618, 566), (708, 540), (868, 500),
]

# soft drop shadow
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).polygon([(x, y + 22) for (x, y) in shield], fill=(20, 30, 90, 120))
shadow = shadow.filter(ImageFilter.GaussianBlur(34))
img = Image.alpha_composite(img, shadow)

# shield body
layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(layer).polygon(shield, fill=SHIELD + (255,))
img = Image.alpha_composite(img, layer)

# --- heartbeat pulse ---
pulse = [
    (640, 1040), (820, 1040), (880, 1040),
    (940, 958), (1000, 1182), (1060, 800), (1120, 1120),
    (1180, 1040), (1240, 1040), (1408, 1040),
]
pl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
pd = ImageDraw.Draw(pl)
w = 72
pd.line(pulse, fill=PULSE + (255,), width=w, joint="curve")
# round caps + joins
r = w // 2
for (x, y) in pulse:
    pd.ellipse([x - r, y - r, x + r, y + r], fill=PULSE + (255,))
img = Image.alpha_composite(img, pl)

# --- downsample ---
final = img.resize((OUT, OUT), Image.LANCZOS)
master = os.path.join(HERE, "icon-1024.png")
final.save(master)
print("wrote", master)
