# Windguru Aggelohori collector

Collects fresh Windguru forecast data for spot **105316 (Aggelohori)** and publishes a stable `data/latest.json` for use by ChatGPT or any other client.

## Models

Configured in `config.json`:

- `107` — ALADIN 2.3 km (`alace`) — confirmed from a real spot 105316 response
- `64` — Zephr-HD 2.6 km (`swrfeu`) — confirmed from a real spot 105316 response
- `98` — WRF 3 km Aegean (`wrfgri`) — confirmed by Windguru Micro model mapping
- `117` — IFS-HRES 9 km (`ifs`) — confirmed by Windguru Micro model mapping and independent 2026 iAPI captures
- `3` — GFS 13 km (`gfs`) — confirmed from a real spot 105316 response; kept as a fallback/cross-check

The validation is deliberate: if Windguru changes a numeric ID, that model is rejected rather than silently mislabeled.

## How it works

The collector requests the saved-spot forecast endpoint with:

```text
https://www.windguru.net/int/iapi.php?q=forecast&id_model=<MODEL>&id_spot=105316&ai=1&WGCACHEABLE=21600
```

and sends a normal browser `User-Agent` plus a Windguru `Referer`.

It does **not** store or calculate `rundef` or `cachefix`. Current observed Windguru behavior for saved-spot forecasts is to return the latest run when `rundef` is omitted.

For each model it normalizes:

- `fcst.initstamp + fcst.hours[i]` -> exact forecast timestamp
- `fcst.WINDSPD[i]` -> mean wind, knots
- `fcst.GUST[i]` -> gust, knots
- `fcst.WINDDIR[i]` -> meteorological wind direction, degrees

It also carries temperature, pressure, humidity, cloud and precipitation fields when available.

## GitHub Action

`.github/workflows/update-windguru.yml` checks every hour at minute 17 and can also be run manually. It only creates a new history snapshot when the underlying model runs/stale state change, so hourly checks do not create an endless pile of duplicate history files.

Each successful run updates:

```text
data/latest.json
```

and stores a snapshot under:

```text
data/history/YYYYMMDDTHHMMSSZ.json
```

History older than 90 days is removed automatically. If one model temporarily fails while at least one primary model is freshly available, the last good data for the failed model is retained with `"stale": true`. If no primary model can be freshly fetched, the workflow fails and leaves the previous `latest.json` untouched.

## First setup

1. Create a **public** GitHub repository named `windguru-aggelohori`.
2. Upload all files in this project, preserving the folders.
3. Open **Actions -> Update Windguru data -> Run workflow**.
4. Wait for a green run.
5. Open `data/latest.json` and verify `ok_primary_models` and `errors`.
6. If the commit step gets a 403, open **Settings -> Actions -> General -> Workflow permissions** and enable **Read and write permissions**, then run it again.

Once the first run succeeds, the stable public URL is:

```text
https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/windguru-aggelohori/main/data/latest.json
```

For the account `pstam`, it will be:

```text
https://raw.githubusercontent.com/pstam/windguru-aggelohori/main/data/latest.json
```

## Important note

Windguru `iapi.php` is undocumented/internal. This project intentionally validates model IDs and publishes errors when a model is unavailable instead of fabricating data. If Windguru changes the endpoint, the collector may need adjustment.
