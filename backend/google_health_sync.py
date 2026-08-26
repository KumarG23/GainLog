"""Bounded Google Health reconciliation entry point; no credential output."""
from __future__ import annotations

import sys

from sqlmodel import Session

try:
    from .google_health import GoogleHealthDataError, sync_google_health
    from .main import engine
except ImportError:
    from google_health import GoogleHealthDataError, sync_google_health
    from main import engine


def main() -> int:
    try:
        with Session(engine) as db:
            result = sync_google_health(db)
        print(f"Google Health synced {result['synced_days']} days ({result['start_date']} to {result['end_date']}).")
        return 0
    except GoogleHealthDataError:
        print("Google Health synchronization failed.", file=sys.stderr)
        return 1
    except Exception:
        print("Google Health synchronization failed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
