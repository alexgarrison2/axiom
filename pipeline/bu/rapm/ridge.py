"""Generalized ridge with a prior mean (DESIGN §3.2):

    min_b  || W^1/2 (y - X b) ||^2  +  (b - b0)' L (b - b0),      L = diag(lam)

Normal equations ``(X'WX + L) b = X'Wy + L b0``.  ``Gram`` keeps the running sufficient
statistics (X'WX dense, X'Wy, y'Wy, sum w, n) so a season can be replayed day by day and
solved at any date without refitting from scratch; with ~1,000 skaters per season the system
is ~2,000 x 2,000 and a Cholesky solve takes tens of milliseconds, so the design's sparse CG
warm start is not needed.  Posterior variances use the Gaussian reading of the same model,
``Var(b) = sigma^2 (X'WX + L)^-1`` with ``sigma^2`` the residual variance per unit weight,
computed exactly (dense inverse) instead of the design's Hutchinson approximation.
"""
from __future__ import annotations

import numpy as np
import scipy.linalg as la
import scipy.sparse as sp


class Gram:
    def __init__(self, p: int):
        self.p = p
        self.G = np.zeros((p, p))
        self.r = np.zeros(p)
        self.yy = 0.0
        self.sw = 0.0
        self.n = 0

    def add(self, X: sp.csr_matrix, y: np.ndarray, w: np.ndarray) -> None:
        if X.shape[0] == 0:
            return
        Xw = sp.csr_matrix(X.multiply(w[:, None]))
        g = (Xw.T @ X).tocoo()
        np.add.at(self.G, (g.row, g.col), g.data)
        self.r += Xw.T @ y
        self.yy += float(np.sum(w * y * y))
        self.sw += float(np.sum(w))
        self.n += X.shape[0]

    def copy(self) -> "Gram":
        g = Gram(self.p)
        g.G, g.r, g.yy, g.sw, g.n = self.G.copy(), self.r.copy(), self.yy, self.sw, self.n
        return g

    def solve(self, lam: np.ndarray, b0: np.ndarray, want_inv: bool = False):
        A = self.G.copy()
        A[np.diag_indices_from(A)] += lam
        rhs = self.r + lam * b0
        c = la.cho_factor(A, lower=False, check_finite=False)
        b = la.cho_solve(c, rhs, check_finite=False)
        inv_diag = None
        if want_inv:
            inv_diag = np.diag(la.cho_solve(c, np.eye(self.p), check_finite=False)).copy()
        return b, inv_diag

    def rss(self, b: np.ndarray) -> float:
        """Weighted residual sum of squares sum w (y - Xb)^2 from the sufficient statistics."""
        return float(self.yy - 2 * b @ self.r + b @ self.G @ b)

    def sigma2(self, b: np.ndarray) -> float:
        """Residual variance per unit weight: E[w r^2]."""
        return self.rss(b) / max(self.n, 1)
