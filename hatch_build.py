"""
Hatchling custom build hook — runs `npm run build` inside ./frontend
before every Python package build so the compiled React/Vite assets
(index.html, agent-town.html, agent-valley.html, assets/**) are always
present and up-to-date in src/xsafeclaw/static/.

Why this exists
---------------
Vite outputs its build artefacts to ../src/xsafeclaw/static (see
frontend/vite.config.ts) but those files are git-ignored (see §44 in
.gitignore).  Without this hook a plain `python -m build` would ship a
package that is missing the three HTML entry-points and ships stale JS/CSS,
making the web UI non-functional after `pip install`.

The hook is registered in pyproject.toml under
[tool.hatch.build.hooks.custom] and runs for both the wheel and sdist
targets.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict) -> None:
        frontend_dir = os.path.join(self.root, "frontend")
        package_json = os.path.join(frontend_dir, "package.json")

        if not os.path.exists(package_json):
            self.app.display_warning(
                "hatch_build: frontend/package.json not found — skipping npm build"
            )
            return

        # Prefer npm that's on PATH; fall back to npx on Windows where npm.cmd is typical
        npm = shutil.which("npm") or shutil.which("npm.cmd") or "npm"

        self.app.display_info("hatch_build: running `npm run build` in ./frontend …")
        result = subprocess.run(
            [npm, "run", "build"],
            cwd=frontend_dir,
            stdout=sys.stdout,
            stderr=sys.stderr,
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"hatch_build: `npm run build` failed with exit code {result.returncode}. "
                "Fix the frontend build before packaging."
            )

        # Sanity-check: the three HTML entry-points must now exist
        static_dir = os.path.join(self.root, "src", "xsafeclaw", "static")
        required = ["index.html", "agent-town.html", "agent-valley.html"]
        missing = [f for f in required if not os.path.exists(os.path.join(static_dir, f))]
        if missing:
            raise RuntimeError(
                f"hatch_build: npm build finished but these files are still missing "
                f"in src/xsafeclaw/static/: {missing}"
            )

        self.app.display_info("hatch_build: frontend build OK ✓")
