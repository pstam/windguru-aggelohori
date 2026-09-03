#!/usr/bin/env python3
"""Fetch and normalize Windguru forecasts for a saved spot.

Windguru's /int/iapi.php endpoint is undocumented and may change. The script
uses the saved-spot forecast request pattern observed from the Windguru web UI:
q=forecast&id_model=<id>&id_spot=<spot>&ai=1&WGCACHEABLE=21600

No rundef/cachefix is stored. The backend currently returns the latest run when
rundef is omitted. The script validates model identity before publishing data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DEFAULT_CONFIG = Path(__file__).with_name("config.json")
DEFAULT_OUTPUT = Path(__file__).with_name("data") / "latest.json"
HOSTS = (
    "https://www.windguru.net/int/iapi.php",
    "https://www.windguru.cz/int/iapi.php",
)


def make_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=0.8,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


def compass(deg: float | int | None) -> str | None:
    if deg is None:
        return None
    names = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    ]
    return names[int((float(deg) + 11.25) // 22.5) % 16]


def arr_value(fcst: dict[str, Any], key: str, idx: int) -> Any:
    arr = fcst.get(key)
    if isinstance(arr, list) and idx < len(arr):
        return arr[idx]
    return None


def normalize_payload(payload: dict[str, Any], tz_name: str) -> dict[str, Any]:
    fcst = payload.get("fcst")
    if not isinstance(fcst, dict):
        raise ValueError("Response has no fcst object")

    hours = fcst.get("hours")
    initstamp = fcst.get("initstamp")
    if not isinstance(hours, list) or initstamp is None:
        raise ValueError("Response has no fcst.hours/initstamp")

    tz = ZoneInfo(tz_name)
    init_utc = datetime.fromtimestamp(int(initstamp), tz=timezone.utc)
    points: list[dict[str, Any]] = []

    for i, hour_offset in enumerate(hours):
        t_utc = init_utc + timedelta(hours=float(hour_offset))
        t_local = t_utc.astimezone(tz)
        direction = arr_value(fcst, "WINDDIR", i)

        precip = arr_value(fcst, "APCP1", i)
        if precip is None:
            precip = arr_value(fcst, "APCP", i)

        points.append(
            {
                "time_utc": t_utc.isoformat().replace("+00:00", "Z"),
                "time_local": t_local.isoformat(),
                "hour_offset": hour_offset,
                "wind_kn": arr_value(fcst, "WINDSPD", i),
                "gust_kn": arr_value(fcst, "GUST", i),
                "direction_deg": direction,
                "direction_compass": compass(direction),
                "temperature_c": arr_value(fcst, "TMP", i),
                "pressure_hpa": arr_value(fcst, "SLP", i),
                "relative_humidity_pct": arr_value(fcst, "RH", i),
                "cloud_pct": arr_value(fcst, "TCDC", i),
                "precip_mm": precip,
            }
        )

    wgmodel = payload.get("wgmodel") or {}
    return {
        "id_model": payload.get("id_model") or fcst.get("id_model"),
        "model": payload.get("model") or wgmodel.get("model"),
        "model_name": fcst.get("model_name") or wgmodel.get("model_name"),
        "model_longname": fcst.get("model_longname") or wgmodel.get("model_longname"),
        "resolution_km": wgmodel.get("resolution_real", wgmodel.get("resolution")),
        "pro": wgmodel.get("pro"),
        "init_utc": init_utc.isoformat().replace("+00:00", "Z"),
        "update_last": fcst.get("update_last"),
        "update_next": fcst.get("update_next"),
        "rundef_received": wgmodel.get("rundef"),
        "forecast": points,
    }


def validate_model(raw: dict[str, Any], model_cfg: dict[str, Any]) -> None:
    got_id = raw.get("id_model") or (raw.get("fcst") or {}).get("id_model")
    got_code = raw.get("model") or (raw.get("wgmodel") or {}).get("model")
    got_name = (raw.get("fcst") or {}).get("model_name") or (raw.get("wgmodel") or {}).get("model_name") or ""

    if int(got_id) != int(model_cfg["id_model"]):
        raise ValueError(f"id_model mismatch: expected {model_cfg['id_model']}, got {got_id}")

    expected_code = model_cfg.get("expected_model")
    if expected_code and got_code != expected_code:
        raise ValueError(f"model code mismatch: expected {expected_code}, got {got_code}")

    expected_name = model_cfg.get("expected_name_contains")
    if expected_name and expected_name.lower() not in got_name.lower():
        raise ValueError(f"model name mismatch: expected name containing {expected_name!r}, got {got_name!r}")


def fetch_model(session: requests.Session, spot_id: int, model_cfg: dict[str, Any]) -> tuple[dict[str, Any], str]:
    params = {
        "q": "forecast",
        "id_model": model_cfg["id_model"],
        "id_spot": spot_id,
        "ai": 1,
        "WGCACHEABLE": 21600,
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
        "Referer": f"https://www.windguru.cz/{spot_id}",
        "Accept": "application/json,text/plain,*/*",
    }

    errors: list[str] = []
    for host in HOSTS:
        try:
            r = session.get(host, params=params, headers=headers, timeout=30)
            if r.status_code != 200:
                errors.append(f"{host}: HTTP {r.status_code}: {r.text[:180]}")
                continue
            try:
                data = r.json()
            except Exception as exc:
                errors.append(f"{host}: invalid JSON: {exc}; body={r.text[:180]!r}")
                continue
            if isinstance(data, dict) and data.get("return") == "error":
                errors.append(f"{host}: Windguru error: {data.get('message')}")
                continue
            if not isinstance(data, dict):
                errors.append(f"{host}: unexpected JSON type {type(data).__name__}")
                continue
            validate_model(data, model_cfg)
            return data, r.url
        except Exception as exc:
            errors.append(f"{host}: {type(exc).__name__}: {exc}")

    raise RuntimeError(" | ".join(errors))


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--history-dir", type=Path, default=Path(__file__).with_name("data") / "history")
    parser.add_argument("--no-history", action="store_true")
    parser.add_argument("--fixture", action="append", default=[], help="KEY=/path/to/raw.json; offline testing only")
    args = parser.parse_args()

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    spot_id = int(cfg["spot_id"])
    tz_name = cfg.get("timezone", "Europe/Athens")
    fixture_map: dict[str, Path] = {}
    for spec in args.fixture:
        key, filename = spec.split("=", 1)
        fixture_map[key] = Path(filename)

    session = make_session()
    models: dict[str, Any] = {}
    errors: dict[str, str] = {}
    source_urls: dict[str, str] = {}
    fresh_models: list[str] = []
    stale_models: list[str] = []

    previous: dict[str, Any] = {}
    if args.output.exists():
        try:
            previous = json.loads(args.output.read_text(encoding="utf-8"))
        except Exception:
            previous = {}
    previous_models = previous.get("models") if isinstance(previous.get("models"), dict) else {}

    for model_cfg in cfg["models"]:
        key = model_cfg["key"]
        try:
            if key in fixture_map:
                raw = json.loads(fixture_map[key].read_text(encoding="utf-8"))
                validate_model(raw, model_cfg)
                source_url = f"fixture:{fixture_map[key]}"
            else:
                raw, source_url = fetch_model(session, spot_id, model_cfg)
            models[key] = normalize_payload(raw, tz_name)
            models[key]["stale"] = False
            source_urls[key] = source_url
            fresh_models.append(key)
            print(f"OK {key}: {models[key]['model_name']} init={models[key]['init_utc']}")
        except Exception as exc:
            errors[key] = str(exc)
            old = previous_models.get(key) if isinstance(previous_models, dict) else None
            if isinstance(old, dict) and old.get("forecast"):
                old = dict(old)
                old["stale"] = True
                old["stale_reason"] = str(exc)
                models[key] = old
                stale_models.append(key)
                print(f"STALE {key}: keeping previous data; {exc}", file=sys.stderr)
            else:
                print(f"ERROR {key}: {exc}", file=sys.stderr)

    desired = {"aladin", "zephr", "wrf3", "ifs_hres"}
    fresh_primary = sorted(desired.intersection(fresh_models))
    if not fresh_primary:
        print("No primary model was freshly fetched; leaving existing latest.json untouched", file=sys.stderr)
        return 2

    available_primary = sorted(desired.intersection(models))

    init_times = [m.get("init_utc") for m in models.values() if isinstance(m, dict) and m.get("init_utc")]
    latest_init = max(init_times) if init_times else None
    signature_basis = "|".join(
        f"{key}:{models[key].get('init_utc')}:{int(bool(models[key].get('stale')))}"
        for key in sorted(models)
    )
    run_signature = hashlib.sha256(signature_basis.encode("utf-8")).hexdigest()[:16]

    result = {
        "schema_version": 1,
        "latest_model_init_utc": latest_init,
        "run_signature": run_signature,
        "spot": {
            "id": spot_id,
            "name": cfg.get("spot_name", "Aggelohori"),
            "lat": 40.4911,
            "lon": 22.8140,
            "timezone": tz_name,
        },
        "fresh_primary_models": fresh_primary,
        "available_primary_models": available_primary,
        "missing_primary_models": sorted(desired.difference(models)),
        "stale_models": sorted(stale_models),
        "models": models,
        "errors": errors,
        "source_urls": source_urls,
        "notes": [
            "Windguru iAPI is undocumented and may change.",
            "No rundef/cachefix is stored or required by this collector; each run asks Windguru for the latest saved-spot forecast.",
            "Each forecast point is derived from fcst.initstamp + fcst.hours[i], with WINDSPD/GUST/WINDDIR from the same index i.",
        ],
    }

    write_json(args.output, result)

    if not args.no_history:
        # One snapshot per distinct combination of model run init times/stale state.
        # This avoids creating a new history file every hourly collector check.
        if latest_init:
            stamp = latest_init.replace("-", "").replace(":", "").replace("+00:00", "").replace("Z", "")
            stamp = stamp.replace("T", "T")
        else:
            stamp = "unknown"
        write_json(args.history_dir / f"{stamp}-{run_signature}.json", result)

    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
