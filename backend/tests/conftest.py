import os
from pathlib import Path


TEST_DB = Path("/tmp/gainlog-test.db")
os.environ.setdefault("GAINLOG_DATABASE_URL", f"sqlite:///{TEST_DB}")
