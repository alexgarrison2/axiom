"""Lake layout (DESIGN §2.3).

    data/lake/                       (gitignored; override with PONYXG_LAKE_DIR or --lake-dir)
      raw/{endpoint}/{season}/{key}.json.gz     immutable payloads, exactly as served
      raw/_manifest.jsonl                       append-only fetch log (resume + audit)
      raw/_manifest.parquet                     compacted manifest (last row per endpoint/key)
      parquet/{table}/season={season}/part-0.parquet   zstd, one partition per season
      dq/dq_report_latest.json                  data-quality gate output (bu.lake.dq)
"""
from __future__ import annotations

import os

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO_ROOT = os.path.dirname(PIPELINE_DIR)
DEFAULT_LAKE = os.path.join(REPO_ROOT, "data", "lake")


def lake_root(override: str | None = None) -> str:
    return os.path.abspath(override or os.environ.get("PONYXG_LAKE_DIR") or DEFAULT_LAKE)


class Lake:
    """Path helper bound to one lake root."""

    def __init__(self, root: str | None = None):
        self.root = lake_root(root)

    # raw ------------------------------------------------------------------
    @property
    def raw_dir(self) -> str:
        return os.path.join(self.root, "raw")

    def raw_path(self, endpoint: str, season: int | str, key: int | str) -> str:
        return os.path.join(self.raw_dir, endpoint, str(season), f"{key}.json.gz")

    @property
    def manifest_jsonl(self) -> str:
        return os.path.join(self.raw_dir, "_manifest.jsonl")

    @property
    def manifest_parquet(self) -> str:
        return os.path.join(self.raw_dir, "_manifest.parquet")

    # parquet ----------------------------------------------------------------
    def table_dir(self, table: str) -> str:
        return os.path.join(self.root, "parquet", table)

    def table_path(self, table: str, season: int | str) -> str:
        return os.path.join(self.table_dir(table), f"season={season}", "part-0.parquet")

    # dq ---------------------------------------------------------------------
    @property
    def dq_dir(self) -> str:
        return os.path.join(self.root, "dq")
