"""
House-style drawing kit for the NHL trophy set.

Every trophy is drawn in one 120 x 160 box, standing on y = GROUND, centred on
x = CX, seen from slightly above (cross-sections are ellipses with ry = E * r),
lit from the upper left with a faint cool rim light on the right edge.

Metal bodies are lathe solids (a radius profile swept round the axis) filled
with a cylindrical gradient; plinths are foreshortened prisms whose faces are
shaded by their normal; plaques are mapped onto those faces.
"""
import math

W, H = 120, 160
CX = 60.0
GROUND = 156.0
E = 0.17  # ellipse ratio of cross-sections (viewing elevation)


def f(v):
    s = f'{v:.1f}'
    if s.endswith('.0'):
        s = s[:-2]
    if s == '-0':
        s = '0'
    return s


def pt(x, y):
    return f'{f(x)} {f(y)}'


# ---------------------------------------------------------------- colours ---

def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb2hex(c):
    return '#' + ''.join(f'{max(0, min(255, round(v))):02x}' for v in c)


def mix(a, b, t):
    a, b = hex2rgb(a), hex2rgb(b)
    return rgb2hex(tuple(a[i] + (b[i] - a[i]) * t for i in range(3)))


# Cylindrical metal ramps (stop, colour), left edge to right edge.
RAMPS = {
    'ag': [(0, '#1b2029'), (.07, '#3a4250'), (.2, '#a3aebd'), (.3, '#e9eff6'), (.36, '#ffffff'),
           (.45, '#b9c3cf'), (.6, '#6d788a'), (.8, '#343c49'), (.92, '#252b35'), (1, '#8796ad')],
    # darker silver for recessed parts (interiors of stems, back pieces)
    'agd': [(0, '#14181f'), (.1, '#2c333e'), (.3, '#7b8696'), (.38, '#b4bdc9'), (.5, '#6c7686'),
            (.75, '#2a313b'), (.92, '#1b2028'), (1, '#5d6b80')],
    'au': [(0, '#3a2408'), (.07, '#684513'), (.2, '#c08c34'), (.3, '#efcd7c'), (.36, '#fff1c4'),
           (.45, '#d2a24a'), (.6, '#93671f'), (.8, '#57390f'), (.92, '#3e280a'), (1, '#a8844c')],
    'aud': [(0, '#2a1a06'), (.12, '#56380e'), (.32, '#b48332'), (.4, '#d9b064'), (.55, '#8a611d'),
            (.8, '#47300c'), (1, '#7a6036')],
    'br': [(0, '#24160d'), (.1, '#4a2e19'), (.28, '#9c6a40'), (.36, '#d7a274'), (.46, '#94603a'),
           (.7, '#4d311c'), (.9, '#2c1c10'), (1, '#7c6656')],
    # turned wood (round plinths)
    'wd': [(0, '#1e130c'), (.12, '#3a2416'), (.32, '#6b4426'), (.4, '#7d5230'), (.55, '#55361f'),
           (.8, '#2c1c11'), (1, '#4a3a33')],
    # black lacquer / ebonised wood
    'bk': [(0, '#06080b'), (.15, '#14181e'), (.32, '#38404b'), (.38, '#4a525e'), (.5, '#1d222a'),
           (.8, '#0c0f13'), (1, '#3a4555')],
}

# Flat materials for prism plinths: lit face, shade face, top, edge highlight.
MATS = {
    'walnut': dict(lit='#5a3a26', dark='#22150d', top='#6e4a32', edge='#8a6248'),
    'oak': dict(lit='#8a5a2c', dark='#3e260f', top='#a06c38', edge='#c08a52'),
    'mahog': dict(lit='#6a2a20', dark='#2a0d09', top='#7d3328', edge='#9a5044'),
    'ebony': dict(lit='#2c2522', dark='#0d0a09', top='#3a322e', edge='#574b45'),
    'black': dict(lit='#272d36', dark='#0b0d11', top='#363e4a', edge='#4e5868'),
    'silver': dict(lit='#c9d2de', dark='#3b4350', top='#e6ecf3', edge='#ffffff'),
}

PLAQUE = dict(lit='#7f8a99', dark='#2f3640')


class Art:
    def __init__(self, name):
        self.name = name
        self.parts = []
        self.defs = {}
        self.clip_n = 0

    # -------------------------------------------------------- definitions ---
    def grad(self, key):
        """Horizontal cylindrical gradient on the element's own bounding box."""
        if key not in self.defs:
            stops = ''.join(f'<stop offset="{s:g}" stop-color="{c}"/>' for s, c in RAMPS[key])
            self.defs[key] = f'<linearGradient id="{key}">{stops}</linearGradient>'
        return f'url(#{key})'

    def vgrad(self, key, stops, x1=0, y1=0, x2=0, y2=1):
        if key not in self.defs:
            st = ''.join(f'<stop offset="{s:g}" stop-color="{c}"' + (f' stop-opacity="{o:g}"' if o != 1 else '') + '/>'
                         for s, c, o in stops)
            self.defs[key] = f'<linearGradient id="{key}" x1="{x1:g}" y1="{y1:g}" x2="{x2:g}" y2="{y2:g}">{st}</linearGradient>'
        return f'url(#{key})'

    def raw_def(self, key, s):
        self.defs.setdefault(key, s)
        return f'url(#{key})'

    def add(self, s):
        self.parts.append(s)

    def clip(self, d):
        self.clip_n += 1
        cid = f'c{self.clip_n}'
        self.defs[cid] = f'<clipPath id="{cid}"><path d="{d}"/></clipPath>'
        return cid

    # ----------------------------------------------------------- shapes ---
    def path(self, d, fill='none', stroke=None, sw=None, op=None, extra=''):
        a = f'<path d="{d}"'
        if fill != '#000':
            a += f' fill="{fill}"'
        if stroke:
            a += f' stroke="{stroke}"'
        if sw is not None:
            a += f' stroke-width="{sw:g}"'
        if op is not None and op != 1:
            a += f' opacity="{op:g}"'
        a += extra + '/>'
        self.add(a)

    def ellipse(self, cx, cy, rx, ry, fill, op=None, extra=''):
        o = f' opacity="{op:g}"' if op is not None and op != 1 else ''
        self.add(f'<ellipse cx="{f(cx)}" cy="{f(cy)}" rx="{f(rx)}" ry="{f(ry)}" fill="{fill}"{o}{extra}/>')

    # ------------------------------------------------------------ lathe ---
    @staticmethod
    def _beziers(pts, smooth):
        """Catmull-Rom through pts; corners where smooth[i] is False."""
        segs = []
        n = len(pts)
        for i in range(n - 1):
            p0 = pts[i - 1] if i > 0 else pts[i]
            p1, p2 = pts[i], pts[i + 1]
            p3 = pts[i + 2] if i + 2 < n else pts[i + 1]
            t1 = 1 if (smooth[i] and 0 < i) else 0
            t2 = 1 if (smooth[i + 1] and i + 1 < n - 1) else 0
            c1 = (p1[0] + (p2[0] - p0[0]) / 6 * t1, p1[1] + (p2[1] - p0[1]) / 6 * t1)
            c2 = (p2[0] - (p3[0] - p1[0]) / 6 * t2, p2[1] - (p3[1] - p1[1]) / 6 * t2)
            segs.append((c1, c2, p2))
        return segs

    def lathe_d(self, prof, cx=CX, top_arc=True, bottom_arc=True):
        """prof: [(y, r, smooth)] top to bottom. Returns the silhouette path."""
        right = [(cx + r, y) for y, r, _ in prof]
        sm = [s for _, _, s in prof]
        segs = self._beziers(right, sm)
        d = 'M' + pt(*right[0])
        for c1, c2, p in segs:
            d += 'C' + pt(*c1) + ' ' + pt(*c2) + ' ' + pt(*p)
        yb, rb = prof[-1][0], prof[-1][1]
        if bottom_arc and rb > 0.05:
            d += f'A{f(rb)} {f(rb * E)} 0 0 1 {pt(cx - rb, yb)}'
        else:
            d += 'L' + pt(cx - rb, yb)
        # left side, reversed and mirrored
        rsegs = []
        for i in range(len(segs) - 1, -1, -1):
            c1, c2, p = segs[i]
            prev = right[i]
            rsegs.append(((2 * cx - c2[0], c2[1]), (2 * cx - c1[0], c1[1]), (2 * cx - prev[0], prev[1])))
        for c1, c2, p in rsegs:
            d += 'C' + pt(*c1) + ' ' + pt(*c2) + ' ' + pt(*p)
        yt, rt = prof[0][0], prof[0][1]
        if top_arc and rt > 0.05:
            d += f'A{f(rt)} {f(rt * E)} 0 0 1 {pt(cx + rt, yt)}'
        d += 'Z'
        return d

    def solid(self, prof, mat='ag', cx=CX, cap=True, cap_fill=None, top_arc=True):
        """A lathe solid with a visible top cap (lighter ellipse)."""
        d = self.lathe_d(prof, cx, top_arc=top_arc)
        self.path(d, self.grad(mat))
        yt, rt = prof[0][0], prof[0][1]
        if cap and rt > 0.3:
            self.ellipse(cx, yt, rt, rt * E, cap_fill or self.cap_fill(mat))
        return d

    def cap_fill(self, mat):
        key = 'cap_' + mat
        ramp = RAMPS[mat]
        lo = ramp[2][1]
        hi = ramp[4][1]
        dk = ramp[6][1]
        return self.vgrad(key, [(0, dk, 1), (.55, lo, 1), (1, hi, 1)])

    def ring(self, y, r, color='#ffffff', sw=0.5, op=0.5, cx=CX, half='lower'):
        """A cross-section line (front half of the ellipse)."""
        if half == 'lower':
            d = f'M{pt(cx + r, y)}A{f(r)} {f(r * E)} 0 0 1 {pt(cx - r, y)}'
        else:
            d = f'M{pt(cx - r, y)}A{f(r)} {f(r * E)} 0 0 1 {pt(cx + r, y)}'
        self.path(d, 'none', color, sw, op)

    def groove(self, y, r, cx=CX, depth=0.6, op=0.55):
        """An engraved band: dark line with a highlight just below."""
        self.ring(y, r, '#0b0e13', 0.55, op, cx)
        self.ring(y + depth, r, '#ffffff', 0.35, op * 0.6, cx)

    def opening(self, y, r, cx=CX, mat='ag', lip=0.9):
        """Open mouth of a bowl: rim, then the dark interior."""
        self.ellipse(cx, y, r, r * E, self.cap_fill(mat))
        inner = 'in_' + mat
        if mat.startswith('au'):
            stops = [(0, '#7a5518', 1), (.45, '#3a2408', 1), (1, '#c99a48', 1)]
        else:
            stops = [(0, '#5d6878', 1), (.45, '#151a21', 1), (1, '#9aa6b6', 1)]
        self.ellipse(cx, y + 0.15, r - lip, (r - lip) * E, self.vgrad(inner, stops, 0, 0, 1, 0))

    # ----------------------------------------------------------- prisms ---
    def prism(self, y_top, y_bot, r_top, r_bot, n, rot, mat, cx=CX, plaques=None, top=True, edges=True,
              face_hook=None):
        """A regular n-gon prism (frustum when r_top != r_bot); rot in degrees,
        0 puts a vertex dead front. plaques: list of (u0, v0, u1, v1, shape)
        in face coordinates, applied to every visible face whose width allows."""
        m = MATS[mat]
        verts = [math.radians(rot + k * 360 / n) for k in range(n)]

        def P(theta, y, r):
            return (cx + r * math.sin(theta), y + E * r * math.cos(theta))

        # the top face is drawn after the sides so it overlaps their top edge
        faces = []
        tops = []
        for k in range(n):
            a, b = verts[k], verts[(k + 1) % n]
            mid = math.atan2((math.sin(a) + math.sin(b)) / 2, (math.cos(a) + math.cos(b)) / 2)
            if math.cos(mid) <= 0.03:
                continue
            faces.append((a, b, mid))
        for a, b, mid in faces:
            tl, tr = P(a, y_top, r_top), P(b, y_top, r_top)
            if tl[0] > tr[0]:
                tl, tr = tr, tl
                a, b = b, a
            bl, br = P(a, y_bot, r_bot), P(b, y_bot, r_bot)
            # light from upper-left-front
            lam = max(0.0, min(1.0, 0.5 + 0.62 * (-math.sin(mid) * 0.75 + math.cos(mid) * 0.45)))
            col = mix(m['dark'], m['lit'], lam)
            d = 'M' + pt(*tl) + 'L' + pt(*tr) + 'L' + pt(*br) + 'L' + pt(*bl) + 'Z'
            self.path(d, col)
            # soft vertical falloff toward the bottom of each face
            self.path(d, self.vgrad('fall', [(0, '#000000', 0), (1, '#000000', .28)]))
            fw = tr[0] - tl[0]
            if plaques and fw > 3.5:
                for u0, v0, u1, v1, shape in plaques:
                    self._plaque(tl, tr, br, bl, u0, v0, u1, v1, shape, lam, fw)
            if face_hook:
                face_hook(self, tl, tr, br, bl, lam, fw)
            if edges:
                tops.append(('M' + pt(*tl) + 'L' + pt(*tr), 0.55 * (0.4 + lam)))
        if edges and len(faces) > 1:
            # vertical arrises between visible faces
            xs = []
            for a, b, mid in faces:
                for th in (a, b):
                    xs.append(th)
            for th in set(round(t, 6) for t in xs):
                if math.cos(th) > 0.05:
                    p1, p2 = P(th, y_top, r_top), P(th, y_bot, r_bot)
                    self.path('M' + pt(*p1) + 'L' + pt(*p2), 'none', m['edge'], 0.4, 0.28)
        if top:
            d = 'M' + 'L'.join(pt(*P(t, y_top, r_top)) for t in verts) + 'Z'
            self.path(d, m['top'])
        for d, o in tops:
            self.path(d, 'none', m['edge'], 0.45, o)

    def _plaque(self, tl, tr, br, bl, u0, v0, u1, v1, shape, lam, fw):
        def B(u, v):
            x = (1 - v) * ((1 - u) * tl[0] + u * tr[0]) + v * ((1 - u) * bl[0] + u * br[0])
            y = (1 - v) * ((1 - u) * tl[1] + u * tr[1]) + v * ((1 - u) * bl[1] + u * br[1])
            return x, y
        col = mix(PLAQUE['dark'], PLAQUE['lit'], 0.15 + 0.7 * lam)
        hi = mix(col, '#ffffff', 0.5)
        if shape == 'disc':
            c = B((u0 + u1) / 2, (v0 + v1) / 2)
            a, b = B(u0, (v0 + v1) / 2), B(u1, (v0 + v1) / 2)
            rx = abs(b[0] - a[0]) / 2
            t, bt = B((u0 + u1) / 2, v0), B((u0 + u1) / 2, v1)
            ry = abs(bt[1] - t[1]) / 2
            self.ellipse(c[0], c[1], rx + 0.35, ry + 0.35, '#000000', 0.45)
            self.ellipse(c[0], c[1], rx, ry, col)
            self.ellipse(c[0] - rx * 0.25, c[1] - ry * 0.3, rx * 0.45, ry * 0.35, hi, 0.55)
            return
        if shape == 'leaf':
            c = B((u0 + u1) / 2, (v0 + v1) / 2)
            a, b = B(u0, (v0 + v1) / 2), B(u1, (v0 + v1) / 2)
            s = abs(b[0] - a[0]) / 2
            self.add(f'<path d="{maple_d(c[0], c[1], s)}" fill="{col}"/>')
            return
        if shape == 'stick':
            p1 = B(u0 + (u1 - u0) * 0.15, v0)
            p2 = B(u0 + (u1 - u0) * 0.75, v1 - (v1 - v0) * 0.12)
            p3 = B(u1, v1 - (v1 - v0) * 0.12)
            self.path('M' + pt(*p1) + 'L' + pt(*p2) + 'L' + pt(*p3), 'none', col, 0.9, 1,
                      ' stroke-linecap="round" stroke-linejoin="round"')
            return
        q = [B(u0, v0), B(u1, v0), B(u1, v1), B(u0, v1)]
        d = 'M' + 'L'.join(pt(*p) for p in q) + 'Z'
        self.path(d, col)
        self.path('M' + pt(*q[0]) + 'L' + pt(*q[1]), 'none', hi, 0.3, 0.8)
        if shape == 'text':
            # engraved lines
            for k in range(1, 4):
                vv = v0 + (v1 - v0) * k / 4.2
                a, b = B(u0 + (u1 - u0) * 0.15, vv), B(u1 - (u1 - u0) * 0.15, vv)
                self.path('M' + pt(*a) + 'L' + pt(*b), 'none', '#2b323d', 0.3, 0.7)

    def svg(self, title):
        defs = ''.join(self.defs.values())
        body = ''.join(self.parts)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img">'
                f'<title>{title}</title><defs>{defs}</defs>{body}</svg>')


# ------------------------------------------------------------- maple leaf ---
# Right half of a stylised maple leaf, unit size, apex up (y down), stem at bottom.
_LEAF_R = [(0, -1.0), (0.13, -0.74), (0.3, -0.8), (0.25, -0.42), (0.55, -0.66), (0.5, -0.47),
           (0.82, -0.53), (0.68, -0.31), (0.92, -0.16), (0.55, 0.06), (0.6, 0.24), (0.09, 0.17),
           (0.06, 0.62)]


def maple_pts(cx, cy, s, rot=0.0):
    pts = _LEAF_R + [(-x, y) for x, y in reversed(_LEAF_R)]
    c, sn = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    return [(cx + (x * c - y * sn) * s, cy + (x * sn + y * c) * s) for x, y in pts]


def maple_d(cx, cy, s, rot=0.0):
    return 'M' + 'L'.join(pt(*p) for p in maple_pts(cx, cy, s, rot)) + 'Z'
