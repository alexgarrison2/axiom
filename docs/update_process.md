# Site Update Process

This document outlines the automated process that occurs when updating the site with new data ("update everything").

## Flowchart

```mermaid
graph TD
    Start([Start Update]) --> Prune[Prune & Fetch Data]
    
    subgraph "1. Data Accumulation"
        Prune --> FetchHRef[Fetch H-Ref Stats]
        FetchHRef --> Sanitize[Sanitize History]
        Sanitize --> VerifyNHL[Verify w/ NHL API]
        VerifyNHL --> Scrape[Scrape Latest Games]
    end

    Scrape --> Model[2. Modeling & Scoring]

    subgraph "2. Modeling & Scoring"
        Model --> LoadModel[Load XGBoost Model]
        LoadModel --> ReScore[Re-Score Shots (calc xG)]
        ReScore --> AggxG[Aggregate xG (Total/5v5)]
        AggxG --> UpdateGS[Update GameStats CSV]
    end

    UpdateGS --> Analysis[3. Analysis]

    subgraph "3. Analysis"
        Analysis --> Ratings[Regenerate Team/Goalie Ratings]
        Ratings --> FetchFuture[Fetch Schedule, Goalies, Odds]
    end

    FetchFuture --> Predict[4. Prediction]

    subgraph "4. Prediction"
        Predict --> RunPredict[Run Game Predictions]
        RunPredict --> GenHistory[Generate History Record]
    end

    GenHistory --> Sync[5. Deployment Sync]

    subgraph "5. Deployment Sync"
        Sync --> SyncPublic[Copy Data to public/data/]
        SyncPublic --> SyncLocal[Sync Local Backups]
    end

    SyncLocal --> End([Update Complete])

    style Start fill:#f9f,stroke:#333
    style End fill:#f9f,stroke:#333
```

## Detailed Steps

1.  **Data Accumulation**
    *   **Prune Recent Data**: Removes recent data to force a fresh scrape of the latest games (ensuring updates/corrections are captured).
    *   **Fetch External Stats**: Pulls data from Hockey Reference and NHL API to ensure "source of truth" accuracy for special teams and boxscores.
    *   **Scrape**: Scrapes the latest game data and shot locations.

2.  **Modeling & Scoring**
    *   **Load Model**: Loads the trained XGBoost model.
    *   **Re-Score**: Runs every single shot (historical and new) through the model to calculate Expected Goals (xG).
    *   **Update GameStats**: Updates the main `gamestats.csv` with these fresh xG values.

3.  **Analysis**
    *   **Ratings**: Recalculates team power ratings and goalie performance metrics based on the updated game stats.
    *   **Fetch Future**: Web scrapes DailyFaceoff for starting goalies, Bovada for latest betting odds, and the NHL API for the upcoming schedule.

4.  **Prediction**
    *   **Run Predictions**: Uses the ratings, schedule, and goalie info to predict the outcome and fair odds for upcoming games.
    *   **Generate History**: Archives these predictions into the history file so we can track performance over time.

5.  **Deployment Sync**
    *   **Sync**: Copies all the generated CSVs and JSONs (predictions, odds, stats) into `public/data/` where the Next.js frontend can read them.
    *   **Result**: The site automatically reflects the changes on the next page load (or revalidation).
