"""Explicit bounded entry point for the GainLog V2 shadow importer."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlmodel import SQLModel, Session

try:
    from .google_health_v2 import GoogleHealthV2Error, sync_google_health_v2
    from .main import engine
except ImportError:
    from google_health_v2 import GoogleHealthV2Error, sync_google_health_v2
    from main import engine


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a bounded Google Health V2 shadow import")
    parser.add_argument("--start", help="inclusive local date (YYYY-MM-DD)")
    parser.add_argument("--end", help="exclusive local date (YYYY-MM-DD)")
    parser.add_argument(
        "--complete-days",
        type=int,
        default=14,
        help="latest N complete days when --start/--end are omitted (default: 14)",
    )
    parser.add_argument("--json", action="store_true", help="emit sanitized JSON diagnostics")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if bool(args.start) != bool(args.end):
        print("Both --start and --end are required together.", file=sys.stderr)
        return 2
    if args.start:
        start, end = args.start, args.end
    else:
        if args.complete_days < 1 or args.complete_days > 366:
            print("--complete-days must be between 1 and 366.", file=sys.stderr)
            return 2
        end_day = datetime.now(ZoneInfo("America/New_York")).date()
        start_day = end_day - timedelta(days=args.complete_days)
        start, end = start_day.isoformat(), end_day.isoformat()
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            result = sync_google_health_v2(db, start_date=start, end_date=end)
    except (GoogleHealthV2Error, ValueError):
        print("Google Health V2 shadow import failed.", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print(
            "Google Health V2 shadow import complete: "
            f"{result['start_date']} to {result['end_date']}, "
            f"{result['records_inserted']} inserted, "
            f"{result['records_updated']} updated, "
            f"{result['records_unchanged']} unchanged."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
