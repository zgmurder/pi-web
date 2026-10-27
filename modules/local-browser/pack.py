"""Build the offline connector ZIP with Python's standard library (no runtime dependency)."""
from pathlib import Path
import json
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent
output = root.parents[1] / "public" / "report-chrome-connector.zip"
files = sorted((root / "connector").iterdir())
manifest = json.loads((root / "connector" / "manifest.json").read_text(encoding="utf-8"))
assert manifest["manifest_version"] == 3
assert manifest["minimum_chrome_version"] == "109"
assert (root / "connector" / manifest["background"]["service_worker"]).is_file()
assert (root / "connector" / manifest["action"]["default_popup"]).is_file()
if "--check" in sys.argv:
    with ZipFile(output) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == {f"report-chrome-connector/{path.name}" for path in files}
        for path in files:
            assert archive.read(f"report-chrome-connector/{path.name}") == path.read_bytes(), path.name
    print("PASS offline ZIP matches connector sources and manifest")
    raise SystemExit(0)
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
    for path in files:
        if not path.is_file():
            raise ValueError(f"Unexpected connector directory: {path.name}")
        info = ZipInfo(f"report-chrome-connector/{path.name}", date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes())
print(f"Built {output} ({output.stat().st_size} bytes)")
