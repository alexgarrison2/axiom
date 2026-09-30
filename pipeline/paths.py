"""Canonical file locations for the pipeline.

public/data/ is the single home for every site-facing file. Ratings in
particular live only there (RATINGS_DIR); the old pipeline/ copies drifted
for months because CI never committed them.
"""
import os

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(PIPELINE_DIR)
PUBLIC_DATA_DIR = os.path.join(REPO_ROOT, "public", "data")
DATA_DIR = os.path.join(REPO_ROOT, "data")

RATINGS_DIR = PUBLIC_DATA_DIR
TEAM_RATINGS_FILE = os.path.join(RATINGS_DIR, "team_ratings.json")
GOALIE_RATINGS_FILE = os.path.join(RATINGS_DIR, "goalie_ratings.json")

MANIFEST_FILE = os.path.join(PUBLIC_DATA_DIR, "manifest.json")


def pipeline_path(*parts: str) -> str:
    return os.path.join(PIPELINE_DIR, *parts)


def public_path(*parts: str) -> str:
    return os.path.join(PUBLIC_DATA_DIR, *parts)


def data_path(*parts: str) -> str:
    return os.path.join(DATA_DIR, *parts)
