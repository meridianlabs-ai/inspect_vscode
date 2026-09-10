"""Dump the OpenAPI specs of the Inspect and Scout view servers.

The webview ``http_request`` proxy (``src/core/package/proxy-scope.ts``) rejects
any view-server route it does not recognize. ``check.mjs`` runs every route the
servers actually define through that table, so it needs the servers' route
lists; this script produces them from the installed ``inspect_ai`` and
``inspect_scout`` packages (no server process is started).

Usage:
    python scripts/proxy-routes/dump-openapi.py --out out/proxy-routes

Writes ``inspect.json`` and ``scout.json`` into ``--out``.
"""

from __future__ import annotations

import argparse
import json
from importlib.metadata import version
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="output directory")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # Inspect: the API sub-app is mounted at /api by the standalone server.
    from inspect_ai._view.fastapi_server import view_server_app

    inspect_spec = view_server_app().openapi()
    write(out / "inspect.json", "inspect-ai", "/api", inspect_spec)

    # Scout: the v2 API app is mounted at /api/v2 by the scout view server.
    from inspect_scout._view._api_v2 import v2_api_app

    scout_spec = v2_api_app().openapi()
    write(out / "scout.json", "inspect-scout", "/api/v2", scout_spec)


def write(path: Path, package: str, prefix: str, spec: dict) -> None:
    pkg_version = version(package)
    path.write_text(
        json.dumps(
            {
                "package": package,
                "version": pkg_version,
                "prefix": prefix,
                "openapi": spec,
            },
            indent=2,
        )
    )
    print(f"{package} {pkg_version}: {len(spec.get('paths', {}))} paths -> {path}")


if __name__ == "__main__":
    main()
