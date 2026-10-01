"""Bottom-up (BU) player-impact model for pony xG.

Sub-packages land milestone by milestone (DESIGN §6.1); see ``pipeline/bu/README.md``.
Run modules from ``pipeline/`` (``python -m bu.lake.backfill ...``) so the shared
pipeline helpers (``http_utils``, ``season``) import as top-level modules.
"""
