"""The half-rink grid the isolated-impact maps live on.

Coordinates are the lake's ``x_norm`` / ``y_norm``: the shooting team attacks +x, the attacked
net is at (89, 0), ``y > 0`` is the shooter's left when he faces that net.  Shots are binned on a
fine grid (``RAW_FT`` cells), the regression is solved per fine cell (ridge is linear in the
target, so binning first and smoothing the coefficient maps afterwards is the same as smoothing
every stint's shots), then each coefficient map is smoothed with a Gaussian kernel (``SIGMA_FT``,
mirror boundaries so no shot weight leaks over the boards) and summed into ``OUT_FT`` cells.

Mass is conserved end to end: the sum of a player's output cells is exactly his scalar xG/60
impact (shots from his own half are clamped onto the centre line row, which the site never
draws, so the headline number still counts them).
"""
from __future__ import annotations

import base64

import numpy as np
from scipy.ndimage import gaussian_filter

X_MIN, X_MAX = 0.0, 100.0          # centre line .. end boards
Y_MIN, Y_MAX = -42.5, 42.5         # boards .. boards
RAW_FT = 2.5
OUT_FT = 5.0
SIGMA_FT = 10.0                    # kernel SD: well above the feed's coordinate noise
NX_RAW = int(round((X_MAX - X_MIN) / RAW_FT))   # 40
NY_RAW = int(round((Y_MAX - Y_MIN) / RAW_FT))   # 34
K_RAW = NX_RAW * NY_RAW
F = int(round(OUT_FT / RAW_FT))                 # 2 raw cells per output cell per axis
NX_OUT = NX_RAW // F                            # 20 (x: 0, 5, ..., 95)
NY_OUT = NY_RAW // F                            # 17
X_SHOW = 20.0                                   # the site draws x >= 20 ft (blue line at 25)
IX_SHOW = int(X_SHOW / OUT_FT)                  # first exported output row
NX_EXPORT = NX_OUT - IX_SHOW                    # 16 rows exported


def raw_cell(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Flat raw-cell index (ix * NY_RAW + iy) for shot coordinates; NaN coordinates map to -1."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    ok = np.isfinite(x) & np.isfinite(y)
    ix = np.clip(np.floor((np.nan_to_num(x) - X_MIN) / RAW_FT), 0, NX_RAW - 1).astype(int)
    iy = np.clip(np.floor((np.nan_to_num(y) - Y_MIN) / RAW_FT), 0, NY_RAW - 1).astype(int)
    out = ix * NY_RAW + iy
    out[~ok] = -1
    return out


def smooth(maps: np.ndarray, sigma_ft: float = SIGMA_FT) -> np.ndarray:
    """[n, K_RAW] raw maps -> [n, NX_OUT * NY_OUT] smoothed output maps (mass-preserving)."""
    m = np.asarray(maps, dtype=float).reshape(-1, NX_RAW, NY_RAW)
    s = sigma_ft / RAW_FT
    sm = gaussian_filter(m, sigma=(0, s, s), mode="reflect", truncate=3.0)
    out = sm.reshape(-1, NX_OUT, F, NY_OUT, F).sum(axis=(2, 4))
    return out.reshape(len(m), NX_OUT * NY_OUT)


def export_rows(out_maps: np.ndarray) -> np.ndarray:
    """Output maps -> the exported rows (x >= X_SHOW), [n, NX_EXPORT * NY_OUT]."""
    m = np.asarray(out_maps).reshape(-1, NX_OUT, NY_OUT)
    return m[:, IX_SHOW:, :].reshape(len(m), NX_EXPORT * NY_OUT)


def quantize(vals: np.ndarray, scale: float) -> np.ndarray:
    """Values -> int8 codes ``round(v / scale)`` clipped to [-127, 127]."""
    q = np.rint(np.asarray(vals, dtype=float) / scale)
    return np.clip(q, -127, 127).astype(np.int8)


def b64(codes: np.ndarray) -> str:
    return base64.b64encode(np.asarray(codes, dtype=np.int8).tobytes()).decode("ascii")


def unb64(s: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(s), dtype=np.int8)
