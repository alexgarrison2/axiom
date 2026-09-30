import os
import sys

import pytest

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PIPELINE_DIR not in sys.path:
    sys.path.insert(0, PIPELINE_DIR)


@pytest.fixture(scope='session')
def feature_games():
    import features as F
    games, source = F.load_feature_games(PIPELINE_DIR)
    return games


@pytest.fixture(scope='session')
def training_matrix(feature_games):
    import features as F
    return F.build_training_matrix(feature_games)
