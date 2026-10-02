"""Game-state Monte Carlo (M5): bottom-up rates -> simulated games -> every market we price.

See ``pipeline/bu/sim/README.md``.  Modules:

  engine   vectorised continuous-time simulator (regulation, 3v3 OT, shootout; penalties,
           power plays, pulled goalies, score effects, pace / team shocks)
  markets  simulated outcomes -> market probabilities, fair odds, EV with push handling
  params   the fitted structural parameters (``out/sim_params.json``)
  state    point-in-time team / goalie state (decayed sums), season pack, live CSV updates
  rates    one game's inputs (lineup RAPM + FIN, team state, goalie) -> engine rates
  anchor   tilt / pace solve so the sim matches a target win % and total (bisection)
  live     the predict_games integration (one call per slate, Poisson fallback per game)
  data     fit-time extraction from the lake + RAPM stints cache (not used when serving)
  fit      structural fits and hyper-parameter tuning (fit seasons only)
  validate dev / holdout evaluation against actual outcomes and the naive Poisson
"""
