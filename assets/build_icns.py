#!/usr/bin/env python3
"""Pack the master PNG into a valid .icns container (PNG-based entries)."""
import io, os, struct
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
master = Image.open(os.path.join(HERE, "icon-1024.png")).convert("RGBA")

# OSType -> pixel size (modern PNG-based icns entries)
ENTRIES = [
    (b"icp4", 16),
    (b"icp5", 32),
    (b"icp6", 64),
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic09", 512),
    (b"ic10", 1024),
    (b"ic11", 32),    # 16@2x
    (b"ic12", 64),    # 32@2x
    (b"ic13", 256),   # 128@2x
    (b"ic14", 512),   # 256@2x
]

chunks = []
for ostype, size in ENTRIES:
    im = master.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    data = buf.getvalue()
    chunks.append(ostype + struct.pack(">I", len(data) + 8) + data)

body = b"".join(chunks)
icns = b"icns" + struct.pack(">I", len(body) + 8) + body

out = os.path.join(ROOT, "build", "icon.icns")
with open(out, "wb") as f:
    f.write(icns)
print("wrote", out, len(icns), "bytes")
