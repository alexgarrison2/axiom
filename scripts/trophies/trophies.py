"""
NHL trophy illustrations for the player page (public/trophies/*.svg).

Drawn by hand in code, one function per trophy, with the house kit in core.py;
real trophies (Hockey Hall of Fame / Wikimedia Commons photos) were used as
visual reference only, nothing is traced. See public/trophies/SOURCES.md.

    python3 scripts/trophies/trophies.py public/trophies [key ...]
"""
import math, os, sys
from core import Art, CX, E, pt, f, maple_d, maple_pts, mix

T = True
F = False
OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/trophies'
os.makedirs(OUT, exist_ok=True)
REG = {}


def trophy(key, title):
    def deco(fn):
        REG[key] = (fn, title)
        return fn
    return deco


# ------------------------------------------------------------ Stanley Cup ---
@trophy('stanley-cup', 'Stanley Cup')
def stanley(a):
    # barrel: five engraved bands, then the base lip
    a.solid([(150, 30.5, F), (156, 30.5, F)], 'agd', cap=False)
    a.solid([(86, 28.6, F), (150, 29.6, F)], 'ag', cap=False)
    for k in range(1, 5):
        a.groove(86 + k * 12.8, 28.8 + k * 0.2)
    a.ring(149.6, 29.6, '#ffffff', 0.5, 0.5)
    # shoulder: flare from the tiers out to the barrel
    a.solid([(73, 18.6, F), (79, 19.6, T), (84, 26.5, T), (86.4, 28.8, F)], 'ag', cap=True)
    a.groove(78.6, 19.6, depth=0.5)
    # three stepped tiers under the bowl
    a.solid([(63, 15.6, F), (73, 16.4, F)], 'ag')
    a.solid([(53, 12.8, F), (63, 13.4, F)], 'ag')
    a.solid([(43, 10.4, F), (53, 10.9, F)], 'ag')
    for y, r in ((72.6, 16.4), (62.6, 13.4), (52.6, 10.9)):
        a.ring(y, r, '#0b0e13', 0.5, 0.6)
    # collar and neck
    a.solid([(36.5, 5, F), (39, 6.5, T), (41.5, 9.6, T), (43.4, 10.4, F)], 'ag', cap=False)
    a.solid([(31, 7.4, T), (33.5, 5, T), (36.8, 5.2, F)], 'agd', cap=False)
    # the bowl: plain rim band over a fluted belly
    prof = [(8, 22.5, F), (10, 23, T), (16, 22.6, T), (24, 18.5, T), (29, 12, T), (32, 7.4, F)]
    d = a.lathe_d(prof)
    a.path(d, a.grad('ag'))
    cid = a.clip(d)
    flutes = []
    for k in range(-9, 10):
        u = k / 9.5
        x0 = CX + 22.4 * math.sin(u * math.pi / 2)
        x1 = CX + 9 * math.sin(u * math.pi / 2 + 0.35)
        flutes.append(f'M{pt(x0, 15.5 + 2.6 * math.cos(u * math.pi / 2))}Q{pt((x0 + x1) / 2 + 2.2, 24)} {pt(x1, 31)}')
    a.add(f'<g clip-path="url(#{cid})" fill="none"><path d="{"".join(flutes)}" stroke="#0c1016" stroke-width=".7" opacity=".45"/>'
          f'<path d="{"".join(flutes)}" stroke="#fff" stroke-width=".35" opacity=".35" transform="translate(.7 0)"/></g>')
    a.groove(15.2, 22.7, depth=0.5)
    a.opening(8, 22.5)


# ------------------------------------------------------------------- Hart ---
@trophy('hart', 'Hart Memorial Trophy')
def hart(a):
    a.prism(152, 156, 26, 26, 8, 22.5, 'walnut', top=False)
    plaques = [(0.12, 0.1 + i * 0.17, 0.88, 0.22 + i * 0.17, 'plain') for i in range(5)]
    a.prism(124, 152, 22.5, 24, 8, 22.5, 'walnut', plaques=plaques)
    # foot: a stepped silver dome
    a.solid([(120.5, 18.5, F), (124.4, 18.5, F)], 'ag')
    a.solid([(108, 6.5, T), (112, 9, T), (117, 15, T), (120.6, 17.2, F)], 'ag')
    a.groove(116.5, 14.8, depth=0.45)
    # the long trumpet stem with collars
    a.solid([(52, 2.6, F), (60, 2.3, T), (80, 2.5, T), (96, 3.3, T), (104, 5, T), (108.4, 6.8, F)], 'ag', cap=False)
    a.solid([(56, 4.2, F), (58.5, 4.2, F)], 'ag')
    a.solid([(98, 5.2, F), (100.5, 5.2, F)], 'ag')
    a.solid([(48, 3, T), (50.5, 5.6, T), (53, 3, F)], 'ag', cap=False)
    # flame vessel: pointed top, full rounded belly
    prof = [(4, 0, F), (8, 4.4, T), (15, 14, T), (25, 21.5, T), (35, 23.6, T), (43, 19.5, T), (48.5, 10, T), (50.5, 3, F)]
    d = a.lathe_d(prof, top_arc=False)
    a.path(d, a.grad('ag'))
    cid = a.clip(d)
    # the swirling flame relief: three tongues wrapping up toward the point
    tongues = ''.join([
        'M42 46C30 38 40 26 52 22C59 19 60 12 60 6',
        'M58 48C49 40 55 30 66 27C73 25 66 14 61 7',
        'M78 44C72 36 76 30 79 25C82 20 70 12 62 7',
    ])
    a.add(f'<g clip-path="url(#{cid})" fill="none" stroke-linecap="round">'
          f'<path d="{tongues}" stroke="#0b0e13" stroke-width="1.6" opacity=".38"/>'
          f'<path d="{tongues}" stroke="#fff" stroke-width=".6" opacity=".55" transform="translate(-.9 -.4)"/></g>')


# ----------------------------------------------------------------- Vezina ---
@trophy('vezina', 'Vezina Trophy')
def vezina(a):
    a.prism(150, 156, 37, 37, 4, 18, 'walnut', top=False)
    a.prism(132, 150, 35, 35.5, 4, 18, 'walnut', plaques=[(0.06 + i * 0.148, 0.3, 0.17 + i * 0.148, 0.75, 'plain') for i in range(6)])
    a.prism(108, 132, 31, 31.5, 4, 18, 'walnut', plaques=[(0.3, 0.2, 0.7, 0.75, 'text')])
    a.prism(104, 108, 33, 33, 4, 18, 'walnut')
    # silver bell
    a.solid([(78, 13, F), (84, 14.5, T), (92, 20, T), (98, 27, T), (101.5, 29, F), (104, 29, F)], 'ag')
    a.groove(98.6, 27.2, depth=0.5)
    a.solid([(74, 17, F), (78.2, 17, F)], 'ag')
    a.ring(74.2, 17, '#fff', 0.5, 0.6)
    # pavilion: back columns, the net, front columns
    for x in (CX - 9, CX + 9):
        a.solid([(46, 1.2, F), (74, 1.2, F)], 'agd', cx=x, cap=False)
    # net inside the pavilion
    net = []
    for i in range(7):
        x = 50.5 + i * 3.2
        net.append(f'M{pt(x, 59)}L{pt(x, 72)}')
    for j in range(5):
        y = 59.5 + j * 3
        net.append(f'M{pt(50.5, y)}L{pt(69.7, y)}')
    a.path('M50 58H70V73H50Z', '#0d1117', op=0.85)
    a.path(''.join(net), 'none', '#9aa6b6', 0.35, 0.8)
    a.path('M50 73V58H70V73', 'none', '#d0d8e2', 0.9, 1, ' stroke-linejoin="round"')
    for x in (CX - 15.5, CX + 15.5):
        a.solid([(46, 1.6, F), (74, 1.6, F)], 'ag', cx=x, cap=False)
        a.solid([(44, 2.6, F), (46.5, 2.2, F)], 'ag', cx=x, cap=False)
        a.solid([(72, 2.2, F), (74.5, 2.6, F)], 'ag', cx=x, cap=False)
    # entablature and dome
    a.solid([(40, 18.5, F), (44.5, 18.5, F)], 'ag', cap=False)
    a.groove(42.2, 18.5, depth=0.5)
    a.solid([(21, 1.8, F), (25, 4, T), (31, 11, T), (36, 15.5, T), (40.2, 19.5, F)], 'ag', cap=False)
    a.groove(35.4, 15.3, depth=0.5)
    # finial: a dark globe on a short stem
    a.solid([(15.5, 1.3, F), (21.4, 1.6, F)], 'ag', cap=False)
    a.ellipse(CX, 11, 5.4, 5.4, a.raw_def('globe', '<radialGradient id="globe" cx=".36" cy=".32" r=".75">'
              '<stop offset="0" stop-color="#7a8696"/><stop offset=".35" stop-color="#2a313b"/>'
              '<stop offset="1" stop-color="#0b0e12"/></radialGradient>'))
    a.path(f'M{pt(CX - 5.4, 11)}A5.4 1.3 0 0 0 {pt(CX + 5.4, 11)}', 'none', '#a3aebd', 0.4, 0.6)


# ----------------------------------------------------------------- Norris ---
@trophy('norris', 'James Norris Memorial Trophy')
def norris(a):
    a.prism(152, 156, 37, 37, 8, 22.5, 'oak', top=False)
    a.prism(125, 152, 34, 36, 8, 22.5, 'oak', plaques=[(0.1, 0.14, 0.9, 0.4, 'plain'), (0.1, 0.52, 0.9, 0.78, 'plain')])
    a.prism(100, 122, 25, 27, 8, 22.5, 'oak', plaques=[(0.1, 0.16, 0.9, 0.42, 'plain'), (0.1, 0.55, 0.9, 0.81, 'plain')])
    # foot
    a.solid([(85, 5, T), (88, 8, T), (94, 16, T), (98.5, 20, F), (100.6, 20, F)], 'ag')
    a.groove(97.8, 19.6, depth=0.5)
    # knopped stem
    a.solid([(62, 8, T), (65, 5, T), (69, 3.6, T), (73, 5.8, T), (76, 6.4, T), (79, 4, T), (82, 3.8, T), (85.4, 5.2, F)], 'ag', cap=False)
    # bowl
    prof = [(27, 21.8, F), (40, 21.6, T), (50, 18, T), (57, 13, T), (62.5, 7.5, F)]
    a.solid(prof, 'ag', cap=False)
    a.groove(36, 21.7, depth=0.6)
    a.groove(52.8, 16.6, depth=0.5)
    # lid: rim, dome, finial
    a.solid([(24.5, 23.4, F), (27.6, 23.4, F)], 'ag')
    a.solid([(13, 3, T), (16, 10, T), (20, 18, T), (24.8, 22.6, F)], 'ag', cap=False)
    a.groove(19.8, 17.8, depth=0.4)
    a.solid([(6, 0.8, T), (7.5, 2, T), (10, 2.4, T), (12, 1.6, T), (13.5, 3.2, F)], 'ag', cap=False)


# ----------------------------------------------------------------- Calder ---
@trophy('calder', 'Calder Memorial Trophy')
def calder(a):
    a.prism(150, 156, 37, 38, 4, 16, 'ebony', top=False)
    grid = [(0.1 + c * 0.28, 0.1 + r * 0.22, 0.32 + c * 0.28, 0.27 + r * 0.22, 'plain') for c in range(3) for r in range(4)]
    a.prism(116, 150, 32, 32.5, 4, 16, 'ebony', plaques=grid)
    a.prism(112, 116, 34.5, 34.5, 4, 16, 'ebony')
    a.prism(78, 112, 30, 30.5, 4, 16, 'ebony', plaques=grid)
    # foot and stem
    a.solid([(67, 5, T), (70, 8, T), (74, 12.5, T), (76.5, 14, F), (78.6, 14, F)], 'ag')
    a.solid([(55, 4.6, T), (58, 2.6, T), (61, 4.4, T), (63.5, 4.2, T), (66, 2.8, T), (67.5, 5, F)], 'ag', cap=False)
    # handles behind/beside the cup
    hd = 'M44.6 13C33 11 32 21 36 27C39 32 43 35 46.5 41'
    a.path(hd, 'none', '#1b2029', 3.4, 1, ' stroke-linecap="round"')
    a.path(hd, 'none', a.grad('ag'), 2.4, 1, ' stroke-linecap="round"')
    a.path('M44.6 12.5C34.4 11 33.3 20 36.6 26', 'none', '#fff', 0.5, 0.6, ' stroke-linecap="round"')
    hd2 = 'M75.4 13C87 11 88 21 84 27C81 32 77 35 73.5 41'
    a.path(hd2, 'none', '#1b2029', 3.4, 1, ' stroke-linecap="round"')
    a.path(hd2, 'none', a.grad('ag'), 2.4, 1, ' stroke-linecap="round"')
    # tulip cup with fluted lower half
    prof = [(8, 15, F), (12, 14.4, T), (24, 15.6, T), (36, 14, T), (46, 10, T), (52, 6, T), (55.5, 4.6, F)]
    d = a.lathe_d(prof)
    a.path(d, a.grad('ag'))
    cid = a.clip(d)
    fl = ''.join(f'M{pt(CX + 15 * math.sin(k / 6 * 1.35), 30)}Q{pt(CX + 12 * math.sin(k / 6 * 1.35), 44)} {pt(CX + 4.4 * math.sin(k / 6 * 1.35), 55)}' for k in range(-6, 7))
    a.add(f'<g clip-path="url(#{cid})" fill="none"><path d="{fl}" stroke="#0c1016" stroke-width=".7" opacity=".45"/>'
          f'<path d="{fl}" stroke="#fff" stroke-width=".35" opacity=".35" transform="translate(.7 0)"/></g>')
    a.groove(29.6, 15.4, depth=0.5)
    a.groove(12.5, 14.4, depth=0.4)
    a.opening(8, 15)



# ------------------------------------------------------------ shared bits ---
def user_grad(a, key, ramp_key, x0, x1):
    from core import RAMPS
    stops = ''.join(f'<stop offset="{o:g}" stop-color="{c}"/>' for o, c in RAMPS[ramp_key])
    return a.raw_def(key, f'<linearGradient id="{key}" gradientUnits="userSpaceOnUse" x1="{f(x0)}" y1="0" x2="{f(x1)}" y2="0">{stops}</linearGradient>')


def handle(a, d, mat='ag', w=2.4, hi=None):
    a.path(d, 'none', '#141820', w + 1.0, 1, ' stroke-linecap="round" stroke-linejoin="round"')
    a.path(d, 'none', a.grad(mat), w, 1, ' stroke-linecap="round" stroke-linejoin="round"')
    if hi:
        a.path(hi, 'none', '#fff', w * 0.22, 0.6, ' stroke-linecap="round"')


def cyl_plaques(a, y0, y1, r, n, span=70, cx=CX, shape='plain', wfrac=0.7, dim=0.0):
    """Plaques set round a drum: n of them across +-span degrees."""
    from core import PLAQUE
    for k in range(n):
        th = math.radians(-span + 2 * span * k / max(1, n - 1)) if n > 1 else 0
        c = math.cos(th)
        x = cx + r * math.sin(th)
        w = (2 * span / max(1, n - 1)) * math.pi / 180 * r * wfrac * c
        lam = max(0, min(1, 0.55 - 0.5 * math.sin(th) + 0.2 * c))
        col = mix(mix(PLAQUE['dark'], PLAQUE['lit'], 0.15 + 0.7 * lam), '#2a1a10', dim)
        yo = E * r * c
        if shape == 'shield':
            hh = y1 - y0
            d = (f'M{pt(x - w / 2, y0 + yo)}L{pt(x + w / 2, y0 + yo)}L{pt(x + w / 2, y0 + yo + hh * .55)}'
                 f'Q{pt(x + w / 2, y1 + yo)} {pt(x, y1 + yo)}Q{pt(x - w / 2, y1 + yo)} {pt(x - w / 2, y0 + yo + hh * .55)}Z')
        else:
            d = f'M{pt(x - w / 2, y0 + yo)}L{pt(x + w / 2, y0 + yo)}L{pt(x + w / 2, y1 + yo)}L{pt(x - w / 2, y1 + yo)}Z'
        a.path(d, col)


def figure(a, x0, y0, s, ramp, key, flip=False, dark='#1a1006', hl='#fff6dc'):
    """A skater in profile, driving forward: torso pitched over the front
    skate, back leg pushing off, stick down in both hands. Faces left (flip
    to face right). Local box 0..50 x 0..50, blades on local y 50."""
    def T(p):
        x, y = p
        if flip:
            x = 44 - x
        return (x0 + x * s, y0 + y * s)

    def line(ps):
        return 'M' + 'L'.join(pt(*T(p)) for p in ps)

    limbs = [  # (points, width), round caps and joins
        ([(27.6, 24.6), (36.2, 32.4)], 5.6),     # back thigh
        ([(36.2, 32.4), (43.6, 39.6)], 4.0),     # back shin
        ([(20, 13.8), (19.2, 21), (15.6, 25.2)], 3.4),   # far arm (to the top hand)
        ([(18.4, 12.4), (28.4, 23.6)], 9.8),     # torso, shoulder pads to hips
        ([(28.6, 25.4), (21, 33.6)], 5.8),       # front thigh
        ([(21, 33.6), (23.2, 45.2)], 4.2),       # front shin
        ([(18.2, 13.4), (13.2, 20.4), (9.4, 27.2)], 3.6),  # near arm (to the bottom hand)
        ([(17.6, 22.4), (-1.6, 46.6)], 1.5),     # stick shaft
    ]
    fills = [
        'M{a}L{b}L{c}L{d}Z'.format(a=pt(*T((19.2, 44.4))), b=pt(*T((26.6, 44.6))), c=pt(*T((27.2, 48.4))), d=pt(*T((17.4, 48.4)))),  # front boot
        'M{a}L{b}L{c}L{d}Z'.format(a=pt(*T((41.8, 37.4))), b=pt(*T((46.2, 40.4))), c=pt(*T((45.2, 44))), d=pt(*T((40.6, 41.8)))),   # back boot
        'M{a}C{b} {c} {d}Z'.format(a=pt(*T((24.8, 25.6))), b=pt(*T((25.4, 19.6))), c=pt(*T((33.6, 19.8))), d=pt(*T((33.2, 27.4)))),  # breezers
    ]
    blades = [line([(16.2, 50), (28.6, 50)]), line([(41, 43.6), (48.6, 47.4)]), line([(-1.4, 46.4), (-8.4, 47.6)])]
    circles = [((14.4, 7.6), 3.9), ((9.2, 27.4), 2.3), ((15.6, 25.2), 2.2), ((28.8, 26.2), 4.4)]
    gid = user_grad(a, key, ramp, x0 - 9 * s if not flip else x0 - 6 * s, x0 + 50 * s)
    lc = ' stroke-linecap="round" stroke-linejoin="round" fill="none"'
    g = []
    o = 1.3
    # outline pass
    for ps, w in limbs:
        g.append(f'<path d="{line(ps)}" stroke="{dark}" stroke-width="{f((w + o) * s)}"{lc}/>')
    for d in blades:
        g.append(f'<path d="{d}" stroke="{dark}" stroke-width="{f(2.3 * s)}"{lc}/>')
    for d in fills:
        g.append(f'<path d="{d}" fill="{dark}" stroke="{dark}" stroke-width="{f(o * s)}" stroke-linejoin="round"/>')
    for c, r in circles:
        c = T(c)
        g.append(f'<circle cx="{f(c[0])}" cy="{f(c[1])}" r="{f((r + o / 2) * s)}" fill="{dark}"/>')
    # metal pass, back to front (far arm under the torso, near arm over it)
    order = [0, 1, 2, 3, 'breezers', 4, 5, 'boots', 6, 7]
    for item in order:
        if item == 'breezers':
            g.append(f'<path d="{fills[2]}" fill="{gid}"/>')
            c = T((28.8, 26.2))
            g.append(f'<circle cx="{f(c[0])}" cy="{f(c[1])}" r="{f(4.4 * s)}" fill="{gid}"/>')
        elif item == 'boots':
            for d in fills[:2]:
                g.append(f'<path d="{d}" fill="{gid}"/>')
            for d in blades:
                g.append(f'<path d="{d}" stroke="{gid}" stroke-width="{f(1.0 * s)}"{lc}/>')
        else:
            ps, w = limbs[item]
            g.append(f'<path d="{line(ps)}" stroke="{gid}" stroke-width="{f(w * s)}"{lc}/>')
            if item == 2:  # far arm sits in shadow
                g.append(f'<path d="{line(ps)}" stroke="{dark}" stroke-width="{f(w * s)}" opacity=".35"{lc}/>')
    for c, r in circles[:3]:
        c = T(c)
        g.append(f'<circle cx="{f(c[0])}" cy="{f(c[1])}" r="{f(r * s)}" fill="{gid}"/>')
    # seams between overlapping masses, then light along the upper edges
    seams = [[(13.6, 14.6), (22.4, 24.4)], [(24.6, 27.8), (30.6, 21.6)], [(21.6, 33.4), (23.4, 34.8)]]
    for ps in seams:
        g.append(f'<path d="{line(ps)}" stroke="{dark}" stroke-width="{f(0.8 * s)}" opacity=".5"{lc}/>')
    lights = [[(21.6, 9.4), (31.2, 19.8)], [(12.2, 4.8), (15.6, 4)], [(29.6, 22.4), (36.6, 29.4), (42.6, 35.6)],
              [(16.8, 12.2), (12, 18.8)], [(26.6, 23.2), (19.6, 31)]]
    for ps in lights:
        g.append(f'<path d="{line(ps)}" stroke="{hl}" stroke-width="{f(0.6 * s)}" opacity=".4"{lc}/>')
    a.add('<g>' + ''.join(g) + '</g>')


# --------------------------------------------------------------- Art Ross ---
@trophy('art-ross', 'Art Ross Trophy')
def art_ross(a):
    a.prism(150, 156, 46, 46, 4, 12, 'walnut', top=False)
    rows = []
    for r, (v0, v1, n) in enumerate(((0.08, 0.175, 3), (0.3, 0.395, 3), (0.53, 0.625, 4), (0.77, 0.865, 4))):
        for c in range(n):
            u = 0.06 + 0.88 * (c + 0.5) / n
            rows.append((u - 0.11, v0 - 0.008, u + 0.11, v1 + 0.008, "disc"))
    a.prism(66, 150, 25, 43, 4, 12, 'walnut', plaques=rows)
    a.prism(62, 66, 23, 23, 4, 12, 'walnut')
    # foot
    a.solid([(51, 6, T), (54, 8.5, T), (58, 14, T), (60.5, 16.5, F), (62.6, 16.5, F)], 'ag')
    a.groove(59.8, 16, depth=0.5)
    a.solid([(45, 9, T), (48, 6, T), (51.4, 6.4, F)], 'ag', cap=False)
    # the chased bowl
    prof = [(16, 30, F), (18, 29, T), (24, 28.6, T), (34, 24, T), (41, 16, T), (45.5, 9.5, F)]
    d = a.lathe_d(prof)
    a.path(d, a.grad('ag'))
    cid = a.clip(d)
    sw = []
    for k in range(-4, 5):
        x = CX + k * 6.6
        sw.append(f'M{pt(x - 3, 30)}c1.5-4 6-4 6 0s-3 5-6 3')
        sw.append(f'M{pt(x, 37)}c2-3 5-2 4 1')
    sw = ''.join(sw)
    a.add(f'<g clip-path="url(#{cid})" fill="none" stroke-linecap="round"><path d="{sw}" stroke="#0c1016" stroke-width=".8" opacity=".5"/>'
          f'<path d="{sw}" stroke="#fff" stroke-width=".4" opacity=".45" transform="translate(-.5 -.4)"/></g>')
    a.groove(23.4, 28.6, depth=0.5)
    a.groove(41, 16, depth=0.5)
    a.opening(16, 30, lip=1.2)


# ---------------------------------------------------------- Rocket Richard --
@trophy('rocket-richard', 'Maurice "Rocket" Richard Trophy')
def rocket(a):
    a.solid([(150, 34, F), (156, 34, F)], 'bk')
    pl = [(0.24, 0.12, 0.76, 0.26, 'plain'), (0.24, 0.36, 0.76, 0.58, 'text'), (0.24, 0.7, 0.76, 0.84, 'plain')]
    a.prism(78, 150, 19, 29, 8, 22.5, 'black', plaques=pl)
    a.solid([(73, 21, F), (78.2, 21, F)], 'ag')
    # the gold sail: the inside of the far wall, its rim sagging between two tips
    back = (f'M{pt(CX - 52, 13)}C{pt(CX - 30, 30)} {pt(CX + 24, 31)} {pt(CX + 50, 17)}'
            f'C{pt(CX + 38, 34)} {pt(CX + 16, 58)} {pt(CX + 6, 73.2)}L{pt(CX - 6, 73.2)}'
            f'C{pt(CX - 18, 58)} {pt(CX - 38, 32)} {pt(CX - 52, 13)}Z')
    a.path(back, a.vgrad('sail_in', [(0, '#5a3c10', 1), (.45, '#2e1d06', 1), (.8, '#9a7128', 1), (1, '#e7c172', 1)], 0, 0, 1, 0))
    a.path(f'M{pt(CX - 51, 13.6)}C{pt(CX - 30, 30)} {pt(CX + 24, 31)} {pt(CX + 49, 17.6)}', 'none', '#ffe7a8', 0.7, 0.75)
    # front wings: twisted blades rising from the stem to the tips
    lw = (f'M{pt(CX - 52, 13)}C{pt(CX - 38, 32)} {pt(CX - 18, 58)} {pt(CX - 6, 73.2)}L{pt(CX - 1.5, 73.4)}'
          f'C{pt(CX - 9, 60)} {pt(CX - 22, 44)} {pt(CX - 34, 28)}C{pt(CX - 40, 21)} {pt(CX - 46, 16)} {pt(CX - 52, 13)}Z')
    rw = (f'M{pt(CX + 50, 17)}C{pt(CX + 38, 34)} {pt(CX + 16, 58)} {pt(CX + 6, 73.2)}L{pt(CX + 1.5, 73.4)}'
          f'C{pt(CX + 9, 61)} {pt(CX + 21, 46)} {pt(CX + 33, 31)}C{pt(CX + 39, 24)} {pt(CX + 45, 19.5)} {pt(CX + 50, 17)}Z')
    a.path(lw, a.grad('au'))
    a.path(rw, a.grad('au'))
    a.path(f'M{pt(CX - 50.5, 14)}C{pt(CX - 45, 17)} {pt(CX - 40, 21.4)} {pt(CX - 34, 28)}', 'none', '#fff4cf', 0.6, 0.85)
    a.path(f'M{pt(CX + 49, 18)}C{pt(CX + 44, 21)} {pt(CX + 39, 24.6)} {pt(CX + 33, 31)}', 'none', '#fff4cf', 0.5, 0.6)
    figure(a, CX - 20, 15.6, 1.15, 'au', 'fig_au')


# ------------------------------------------------------------ Ted Lindsay ---
@trophy('ted-lindsay', 'Ted Lindsay Award')
def lindsay(a):
    a.prism(147, 156, 18, 27, 6, 30, 'silver')
    a.prism(72, 147, 14, 16, 6, 30, 'black', plaques=[(0.16, 0.06, 0.84, 0.52, 'text'), (0.32, 0.68, 0.68, 0.84, 'plain')])
    a.prism(67, 72, 16, 16, 6, 30, 'silver')
    figure(a, CX - 27, 7.8, 1.18, 'br', 'fig_br', flip=True, dark='#120a04', hl='#f3cfa8')


# ------------------------------------------------------------ Conn Smythe ---
@trophy('conn-smythe', 'Conn Smythe Trophy')
def conn(a):
    a.prism(146, 156, 56, 56, 4, 10, 'walnut', top=False)
    a.prism(104, 146, 47, 54, 4, 10, 'walnut', plaques=[((c + .5) / 5 - .075, .3, (c + .5) / 5 + .075, .7, 'leaf') for c in range(5)])
    a.prism(84, 104, 40, 43, 4, 10, 'walnut', plaques=[((c + .5) / 4 - .085, .2, (c + .5) / 4 + .085, .8, 'leaf') for c in range(4)])
    a.prism(68, 84, 31, 32, 4, 10, 'walnut', plaques=[(.24, .16, .76, .84, 'text')])
    # the spray of silver maple leaves behind the building
    leaves = [(-58, 17, 'agd'), (58, 17, 'agd'), (-29, 19.5, 'ag'), (29, 19.5, 'ag'), (0, 22, 'ag')]
    for ang, sz, mat in leaves:
        r = 22
        x = CX + r * math.sin(math.radians(ang))
        y = 55 - r * math.cos(math.radians(ang))
        d = maple_d(x, y, sz, ang)
        a.path(d, '#10141a', '#10141a', 1.2, None, ' stroke-linejoin="round"')
        a.path(d, a.grad(mat))
        tip = maple_pts(x, y, sz, ang)
        base_x, base_y = x - 0.5 * sz * math.sin(math.radians(ang)), y + 0.5 * sz * math.cos(math.radians(ang))
        a.path(f'M{pt(*tip[0])}L{pt(base_x, base_y)}', 'none', '#1f252e', 0.6, 0.7)
    # Maple Leaf Gardens in silver: walls, windows, vaulted roof
    def windows(a2, tl, tr, br, bl, lam, fw):
        if fw < 20:
            return
        for r_ in range(3):
            for c in range(9):
                u0 = 0.08 + c * 0.095
                v0 = 0.18 + r_ * 0.26
                x = tl[0] + (tr[0] - tl[0]) * u0
                y = tl[1] + (tr[1] - tl[1]) * u0 + (bl[1] - tl[1]) * v0
                a2.path(f'M{pt(x, y)}h{f(fw * 0.055)}v{f(3.2 if r_ < 2 else 4.2)}h{f(-fw * 0.055)}Z', '#1b2029', op=0.85)
    a.prism(48, 68, 26, 26, 4, 10, 'silver', face_hook=windows, top=False)
    # roof: a low vault over the top face
    p = lambda th, y, r: (CX + r * math.sin(math.radians(th)), y + E * r * math.cos(math.radians(th)))
    fl, fr = p(-35, 48, 26), p(55, 48, 26)
    bl_, br_ = p(-125, 48, 26), p(145, 48, 26)
    roof = (f'M{pt(*fl)}Q{pt((fl[0] + fr[0]) / 2, fl[1] - 9)} {pt(*fr)}'
            f'L{pt(*br_)}Q{pt((bl_[0] + br_[0]) / 2, br_[1] - 9)} {pt(*bl_)}Z')
    a.path(roof, a.vgrad('roof', [(0, '#aab4c3', 1), (1, '#4b5464', 1)]))
    a.path(f'M{pt(*fl)}Q{pt((fl[0] + fr[0]) / 2, fl[1] - 9)} {pt(*fr)}', 'none', '#e9eff6', 0.5, 0.6)


# ------------------------------------------------------------------ Selke ---
@trophy('selke', 'Frank J. Selke Trophy')
def selke(a):
    a.prism(150, 156, 47, 47, 6, 30, 'mahog', top=False)
    pl = [(0.14, 0.12 + r * 0.28, 0.86, 0.28 + r * 0.28, 'plain') for r in range(3)]
    a.prism(94, 150, 41, 44, 6, 30, 'mahog', plaques=pl)
    # gadrooned foot
    prof = [(68, 13, T), (74, 15, T), (82, 22, T), (88, 26, T), (91, 27, F), (94.6, 27, F)]
    d = a.lathe_d(prof)
    a.path(d, a.grad('ag'))
    cid = a.clip(d)
    gd = ''.join(f'M{pt(CX + 15 * math.sin(k / 9 * 1.4), 74.5 + 2.4 * math.cos(k / 9 * 1.4))}L{pt(CX + 25 * math.sin(k / 9 * 1.4), 87 + 4 * math.cos(k / 9 * 1.4))}' for k in range(-9, 10))
    a.add(f'<g clip-path="url(#{cid})" fill="none"><path d="{gd}" stroke="#0c1016" stroke-width=".9" opacity=".5"/>'
          f'<path d="{gd}" stroke="#fff" stroke-width=".4" opacity=".4" transform="translate(.8 0)"/></g>')
    a.groove(90.6, 27, depth=0.5)
    # back cresting peeks over the rim
    def lobes(front):
        """Scallop shells standing on the rim, overlapping into a crown."""
        out = []
        for k in range(-5, 6):
            th = math.radians(k * 16)
            c = math.cos(th)
            x = CX + 33 * math.sin(th)
            y = 30.6 + (E * 33 * c if front else -E * 33 * c)
            w = 8.6 * max(0.3, c)
            h = 7.2 if k % 2 == 0 else 5.4
            out.append(f'M{pt(x - w / 2, y)}C{pt(x - w * .62, y - h * .7)} {pt(x - w * .3, y - h)} {pt(x, y - h)}'
                       f'C{pt(x + w * .3, y - h)} {pt(x + w * .62, y - h * .7)} {pt(x + w / 2, y)}Z')
        return ''.join(out)

    def ribs(front):
        out = []
        for k in range(-5, 6):
            th = math.radians(k * 16)
            c = math.cos(th)
            if c < 0.45:
                continue
            x = CX + 33 * math.sin(th)
            y = 30.6 + (E * 33 * c if front else -E * 33 * c)
            w = 8.6 * c
            h = 7.2 if k % 2 == 0 else 5.4
            for t in (-0.25, 0, 0.25):
                out.append(f'M{pt(x + t * w * .5, y - .4)}L{pt(x + t * w * 1.1, y - h * .82)}')
        return ''.join(out)
    a.path(lobes(False), a.grad('agd'))
    # ring handles at the sides
    for sx in (-1, 1):
        a.add(f'<ellipse cx="{f(CX + sx * 35.5)}" cy="44" rx="3.6" ry="4.4" fill="none" stroke="#141820" stroke-width="2.4"/>'
              f'<ellipse cx="{f(CX + sx * 35.5)}" cy="44" rx="3.6" ry="4.4" fill="none" stroke="#aab4c3" stroke-width="1.3"/>')
    # the bowl, with garland swags
    prof = [(30, 34, F), (34, 33.5, T), (44, 31, T), (54, 25, T), (62, 17, T), (68.4, 12.5, F)]
    d = a.lathe_d(prof)
    a.path(d, a.grad('ag'))
    cid = a.clip(d)
    sw = ''.join(f'M{pt(CX + k * 12 - 6, 39)}Q{pt(CX + k * 12, 50)} {pt(CX + k * 12 + 6, 39)}' for k in range(-3, 4))
    a.add(f'<g clip-path="url(#{cid})" fill="none" stroke-linecap="round"><path d="{sw}" stroke="#0c1016" stroke-width="1.6" opacity=".45"/>'
          f'<path d="{sw}" stroke="#fff" stroke-width=".6" opacity=".55" transform="translate(-.5 -.6)"/></g>')
    a.groove(37, 33.3, depth=0.5)
    a.groove(58, 21.5, depth=0.5)
    a.opening(30, 34, lip=1.4)
    a.path(lobes(True), '#10141a', '#10141a', 0.9, None, ' stroke-linejoin="round"')
    a.path(lobes(True), a.grad('ag'))
    a.path(ribs(True), 'none', '#2a313b', 0.4, 0.6)


# -------------------------------------------------------------- Lady Byng ---
@trophy('lady-byng', 'Lady Byng Memorial Trophy')
def lady_byng(a):
    a.prism(150, 156, 33, 33, 4, 14, 'walnut', top=False)
    a.prism(108, 150, 28, 29.5, 4, 14, 'walnut', plaques=[(0.12, 0.2, 0.88, 0.78, 'text')])
    a.prism(104, 108, 30.5, 30.5, 4, 14, 'walnut')
    a.solid([(90, 6, T), (94, 10, T), (99, 16, T), (102, 18, F), (104.6, 18, F)], 'ag')
    a.groove(100.6, 17.4, depth=0.5)
    a.solid([(60, 6.4, T), (64, 3.4, T), (69, 5.2, T), (72, 7.4, T), (75, 5, T), (80, 3.6, T), (84, 5.6, T), (87, 4, T), (90.4, 6, F)], 'ag', cap=False)
    # tall square-shouldered handles
    for sx in (-1, 1):
        d = f'M{pt(CX + sx * 15, 30)}C{pt(CX + sx * 23, 29)} {pt(CX + sx * 27, 30)} {pt(CX + sx * 25.5, 36)}C{pt(CX + sx * 24, 44)} {pt(CX + sx * 18, 50)} {pt(CX + sx * 13, 53)}'
        handle(a, d, w=2.2, hi=f'M{pt(CX + sx * 16, 29.4)}C{pt(CX + sx * 23, 28.6)} {pt(CX + sx * 26.4, 29.6)} {pt(CX + sx * 25, 35)}' if sx < 0 else None)
    prof = [(27, 16, F), (32, 15.6, T), (41, 17.4, T), (50, 15, T), (56, 10, T), (60.4, 6.6, F)]
    a.solid(prof, 'ag', cap=False)
    a.groove(34, 15.7, depth=0.5)
    a.groove(48.4, 15.6, depth=0.5)
    a.solid([(24, 17.2, F), (27.6, 17.2, F)], 'ag')
    a.solid([(13, 3, T), (16, 8.5, T), (20, 14, T), (24.4, 16.6, F)], 'ag', cap=False)
    a.solid([(4, 0.6, T), (6, 2.6, T), (9, 3, T), (11.2, 1.8, T), (13.4, 3.2, F)], 'ag', cap=False)


# -------------------------------------------------------------- Masterton ---
def flame(a, x, y, h, w, lean, key='au'):
    d = (f'M{pt(x - w / 2, y)}C{pt(x - w * .7, y - h * .45)} {pt(x + lean - w * .35, y - h * .62)} {pt(x + lean, y - h)}'
         f'C{pt(x + lean + w * .05, y - h * .6)} {pt(x + w * .8, y - h * .5)} {pt(x + w / 2, y)}Z')
    a.path(d, '#1a1006', None, None, None, ' stroke="#1a1006" stroke-width="1" stroke-linejoin="round"')
    a.path(d, a.grad(key))
    a.path(f'M{pt(x - w * .3, y - h * .1)}C{pt(x - w * .45, y - h * .45)} {pt(x + lean - w * .3, y - h * .6)} {pt(x + lean, y - h * .95)}', 'none', '#fff4cf', 0.45, 0.6)


@trophy('masterton', 'Bill Masterton Memorial Trophy')
def masterton(a):
    a.prism(150, 156, 32, 32, 8, 22.5, 'oak', top=False)
    a.prism(114, 150, 27, 28.5, 8, 22.5, 'oak', plaques=[(0.14, 0.08 + r * 0.22, 0.86, 0.24 + r * 0.22, 'plain') for r in range(4)])
    # two torch cones holding gold flames; the shorter one behind, left
    for x, top, bot, r_t, flames in ((CX - 12, 62, 113, 7.5, [(-2.4, 16, 5, -1.5), (1.8, 13, 4.4, 2), (0, 19, 4, 0.5)]),
                                    (CX + 6, 34, 114, 9.5, [(-3.4, 22, 6, -2.5), (3, 18, 5.4, 3), (0, 28, 5, 1), (-1, 12, 4, -3)])):
        for dx, h, w, lean in flames:
            flame(a, x + dx, top + 2, h, w, lean)
        a.solid([(top, r_t, F), (top + 3, r_t, F), ((top + bot) / 2, r_t * 0.62, T), (bot - 3, 2.6, T), (bot, 4.4, F)], 'ag', cx=x)
        a.groove(top + 3.2, r_t, cx=x, depth=0.5)
        a.ellipse(x, top, r_t - 0.8, (r_t - 0.8) * E, '#2a1a06')


# ------------------------------------------------------------ King Clancy ---
@trophy('king-clancy', 'King Clancy Memorial Trophy')
def clancy(a):
    a.solid([(150, 30, F), (156, 30, F)], 'wd', cap=False)
    a.solid([(122, 26.5, F), (150.4, 28.6, F)], 'wd')
    cyl_plaques(a, 131, 141, 27.6, 7, 66, shape='shield', wfrac=0.62, dim=0.35)
    a.solid([(118, 25, F), (122.4, 25, F)], 'wd')
    a.solid([(98, 20.5, F), (118.4, 21.5, F)], 'wd')
    cyl_plaques(a, 104.5, 111, 21, 6, 64, wfrac=0.75, dim=0.35)
    a.solid([(85, 5, T), (89, 9, T), (94, 14.5, T), (96, 16, F), (98.6, 16, F)], 'ag')
    a.solid([(68, 6, T), (72, 3.4, T), (76, 6, T), (80, 3.6, T), (85.4, 5.2, F)], 'ag', cap=False)
    for sx in (-1, 1):
        d = f'M{pt(CX + sx * 18, 36)}C{pt(CX + sx * 30, 30)} {pt(CX + sx * 31, 40)} {pt(CX + sx * 27, 48)}C{pt(CX + sx * 24, 54)} {pt(CX + sx * 18, 57)} {pt(CX + sx * 13, 60)}'
        handle(a, d, w=2.2)
    prof = [(31, 20, F), (46, 20, T), (54, 17.5, T), (62, 12, T), (68.6, 6.4, F)]
    d = a.lathe_d(prof)
    a.path(d, a.grad('ag'))
    cid = a.clip(d)
    gd = ''.join(f'M{pt(CX + 19.8 * math.sin(k / 8 * 1.4), 49)}Q{pt(CX + 16 * math.sin(k / 8 * 1.4), 60)} {pt(CX + 6 * math.sin(k / 8 * 1.4), 68)}' for k in range(-8, 9))
    a.add(f'<g clip-path="url(#{cid})" fill="none"><path d="{gd}" stroke="#0c1016" stroke-width=".8" opacity=".5"/>'
          f'<path d="{gd}" stroke="#fff" stroke-width=".4" opacity=".4" transform="translate(.7 0)"/></g>')
    a.groove(48, 19.9, depth=0.5)
    a.groove(35, 20, depth=0.5)
    # crest on the front
    a.ellipse(CX - 1.6, 41.4, 4.4, 4.0, '#0c1016', 0.3)
    a.ellipse(CX - 2.2, 41, 4.2, 3.8, a.grad('ag'))
    a.ellipse(CX - 2.2, 41, 4.2, 3.8, 'none', extra=' stroke="#e9eff6" stroke-width=".4" opacity=".6"')
    a.solid([(28, 21.6, F), (31.6, 21.6, F)], 'ag')
    a.solid([(15, 4, T), (19, 11, T), (24, 18, T), (28.4, 21, F)], 'ag', cap=False)
    a.groove(23.6, 17.6, depth=0.4)
    a.solid([(3, 0.6, T), (5.5, 2.4, T), (8.5, 3, T), (11.5, 1.6, T), (13, 2.2, T), (15.4, 4.2, F)], 'ag', cap=False)


# --------------------------------------------------------------- Jennings ---
@trophy('jennings', 'William M. Jennings Trophy')
def jennings(a):
    a.prism(151, 156, 46, 46, 4, 12, 'mahog', top=False)
    sticks = lambda n: [((c + .5) / n - .38 / n, .14, (c + .5) / n + .38 / n, .9, 'stick') for c in range(n)]
    a.prism(128, 151, 40.5, 44, 4, 12, 'mahog', plaques=sticks(6))
    a.prism(104, 128, 34, 37, 4, 12, 'mahog', plaques=sticks(5))
    a.prism(78, 104, 28, 30.5, 4, 12, 'mahog', plaques=[(0.22, 0.2, 0.78, 0.62, 'text')])
    a.prism(72, 78, 30, 30, 4, 12, 'black')
    prof = [(58, 9, T), (62, 11, T), (67, 15, T), (70, 16.5, F), (72.6, 16.5, F)]
    d = a.lathe_d(prof)
    a.path(d, a.grad('ag'))
    cid = a.clip(d)
    gd = ''.join(f'M{pt(CX + 10.4 * math.sin(k / 8 * 1.4), 61.5)}L{pt(CX + 16 * math.sin(k / 8 * 1.4), 70.4)}' for k in range(-8, 9))
    a.add(f'<g clip-path="url(#{cid})" fill="none"><path d="{gd}" stroke="#0c1016" stroke-width=".8" opacity=".5"/></g>')
    prof = [(26, 35, F), (29, 35.4, T), (38, 33, T), (48, 25, T), (55, 15, T), (59, 9, F)]
    a.solid(prof, 'ag', cap=False)
    a.groove(31.4, 35.2, depth=0.6)
    a.opening(26, 35, lip=1.4)


# ---------------------------------------------------------------- Messier ---
@trophy('messier', 'Mark Messier NHL Leadership Award')
def messier(a):
    a.prism(138, 156, 22, 24, 4, 30, 'black', plaques=[(0.2, 0.3, 0.8, 0.7, 'plain')])
    # a faceted crystal column with a raking cut top
    cr = a.vgrad('cry', [(0, '#e9f6ff', .9), (.5, '#7fb4d6', .55), (1, '#173048', .85)], 0, 0, 1, 1)
    cr2 = a.vgrad('cry2', [(0, '#9fd2f0', .7), (1, '#0f2233', .9)], 0, 0, 1, 1)
    cr3 = a.vgrad('cry3', [(0, '#4f7fa3', .6), (1, '#0a1622', .9)], 0, 0, 1, 1)
    L, M, R = CX - 15, CX + 3, CX + 13
    top_l, top_m, top_r = 20, 10, 16
    a.path(f'M{pt(L, top_l)}L{pt(M, top_m)}L{pt(M, 138)}L{pt(L + 2, 138)}Z', cr)
    a.path(f'M{pt(M, top_m)}L{pt(R, top_r)}L{pt(R - 1.5, 138)}L{pt(M, 138)}Z', cr2)
    a.path(f'M{pt(L, top_l)}L{pt(M, top_m)}L{pt(R, top_r)}L{pt(CX - 2, 24)}Z', '#e9f6ff', op=0.8)
    a.path(f'M{pt(L, top_l)}L{pt(CX - 2, 24)}L{pt(R, top_r)}', 'none', '#ffffff', 0.5, 0.9)
    a.path(f'M{pt(M, top_m)}L{pt(M, 138)}', 'none', '#ffffff', 0.6, 0.8)
    a.path(f'M{pt(L, top_l)}L{pt(L + 2, 138)}', 'none', '#cfe9ff', 0.5, 0.6)
    a.path(f'M{pt(R, top_r)}L{pt(R - 1.5, 138)}', 'none', '#7fb4d6', 0.5, 0.6)
    # refraction streaks
    a.path(f'M{pt(L + 4, 60)}L{pt(M - 3, 40)}M{pt(L + 5, 96)}L{pt(M - 2, 80)}M{pt(M + 3, 70)}L{pt(R - 3, 58)}', 'none', '#ffffff', 0.7, 0.35)


# ---------------------------------------------------------------- generic ---
@trophy('generic', 'Award')
def generic(a):
    a.prism(150, 156, 32, 32, 4, 14, 'black', top=False)
    a.prism(112, 150, 27, 28.5, 4, 14, 'black', plaques=[(0.18, 0.25, 0.82, 0.7, 'text')])
    a.prism(108, 112, 29.5, 29.5, 4, 14, 'black')
    a.solid([(94, 6, T), (98, 10, T), (103, 15.5, T), (105.5, 17, F), (108.6, 17, F)], 'ag')
    a.groove(104.6, 16.6, depth=0.5)
    a.solid([(70, 7, T), (74, 3.6, T), (82, 3.2, T), (86, 5.6, T), (90, 3.6, T), (94.4, 6, F)], 'ag', cap=False)
    for sx in (-1, 1):
        d = f'M{pt(CX + sx * 19, 26)}C{pt(CX + sx * 32, 24)} {pt(CX + sx * 32, 40)} {pt(CX + sx * 25, 50)}C{pt(CX + sx * 21, 56)} {pt(CX + sx * 16, 60)} {pt(CX + sx * 12, 63)}'
        handle(a, d, w=2.4)
    prof = [(22, 21, F), (26, 20, T), (40, 20.5, T), (54, 16, T), (64, 10, T), (70.6, 7, F)]
    a.solid(prof, 'ag', cap=False)
    a.groove(30, 20.1, depth=0.5)
    a.opening(22, 21, lip=1.1)

def build(only=None):
    for key, (fn, title) in REG.items():
        if only and key not in only:
            continue
        a = Art(key)
        fn(a)
        s = a.svg(title)
        open(os.path.join(OUT, key + '.svg'), 'w').write(s)
        print(f'{key:24s} {len(s):6d} B')


if __name__ == '__main__':
    build(sys.argv[2:] or None)
