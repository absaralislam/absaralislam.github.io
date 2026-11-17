"""يولّد أيقونات PNG للتطبيق بلا مكتبات خارجية (نجمة ثمانية ذهبية على خلفية خضراء)."""
import math, struct, zlib, sys, os

BG = (0x24, 0x58, 0x4a); GOLD = (0xE2, 0xC2, 0x84)

def in_square(x, y, cx, cy, half, ang):
    dx, dy = x - cx, y - cy
    c, s = math.cos(-ang), math.sin(-ang)
    rx, ry = dx * c - dy * s, dx * s + dy * c
    return abs(rx) <= half and abs(ry) <= half

def color_at(x, y, size, scale, rounded):
    # x,y in 0..1 space
    if rounded:
        r = 0.22; px, py = min(x, 1 - x), min(y, 1 - y)
        if px < r and py < r and (r - px) ** 2 + (r - py) ** 2 > r * r:
            return None
    cx = cy = 0.5
    half = 0.23 * scale
    d = math.hypot(x - cx, y - cy)
    if d <= 0.07 * scale: return GOLD
    if d <= 0.14 * scale: return BG
    if in_square(x, y, cx, cy, half, 0) or in_square(x, y, cx, cy, half, math.pi / 4): return GOLD
    return BG

def render(size, scale=1.0, rounded=False, ss=3):
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            acc = [0, 0, 0, 0]
            for a in range(ss):
                for b in range(ss):
                    c = color_at((i + (a + .5) / ss) / size, (j + (b + .5) / ss) / size, size, scale, rounded)
                    if c:
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            n = ss * ss
            alpha = acc[3] // n
            if alpha:
                k = acc[3] / 255
                row += bytes([int(acc[0] / k), int(acc[1] / k), int(acc[2] / k), alpha])
            else:
                row += b"\0\0\0\0"
        rows.append(bytes(row))
    return png(size, b"".join(rows))

def png(size, raw):
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

out = sys.argv[1] if len(sys.argv) > 1 else "icons"
for name, size, scale, rounded in [("icon-192.png", 192, 1, True), ("icon-512.png", 512, 1, True), ("icon-maskable-512.png", 512, .75, False)]:
    with open(os.path.join(out, name), "wb") as f:
        f.write(render(size, scale, rounded))
    print("wrote", name)
