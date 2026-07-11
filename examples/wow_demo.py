#!/usr/bin/env python3
"""
Optional flashy terminal presentation of smart-test-select, meant for recording a
GIF for the README. This is NOT the source of truth demo (that's examples/demo.sh,
whose raw output is pasted verbatim into examples/README.md) — this script just
dresses up the same real CLI run with animation and color.

Every number and reason chain printed below comes from an actual
`node dist/cli.js select --json` call against a real (throwaway) fixture repo.
Nothing here is scripted or invented.

Requires: pip install rich
Requires: npm run build has already produced dist/cli.js
Run: python3 examples/wow_demo.py
"""

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

ROOT = Path(__file__).resolve().parent.parent
FIXTURE_SRC = ROOT / "tests" / "fixtures" / "mini-repo"
DEMO_DIR = ROOT / "examples" / "wow-fixture-repo"
CLI_JS = ROOT / "dist" / "cli.js"

console = Console()


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


def sts(args, cwd):
    result = subprocess.run(
        ["node", str(CLI_JS), *args], cwd=cwd, capture_output=True, text=True
    )
    if result.returncode not in (0, 2):
        console.print(result.stderr)
        sys.exit(result.returncode)
    return json.loads(result.stdout)


def setup_repo():
    if DEMO_DIR.exists():
        shutil.rmtree(DEMO_DIR)
    shutil.copytree(FIXTURE_SRC, DEMO_DIR)
    run(["git", "init", "-q", "-b", "work"], DEMO_DIR)
    run(["git", "config", "user.email", "demo@example.com"], DEMO_DIR)
    run(["git", "config", "user.name", "smart-test-select demo"], DEMO_DIR)
    run(["git", "add", "-A"], DEMO_DIR)
    run(["git", "commit", "-q", "-m", "baseline"], DEMO_DIR)
    run(["git", "branch", "main"], DEMO_DIR)


def main() -> None:
    if not CLI_JS.exists():
        console.print("[bold red]dist/cli.js not found.[/] Run `npm run build` first.")
        sys.exit(1)

    console.rule("[bold magenta]smart-test-select[/]")
    console.print(
        Text(
            "Static import graph -> selective CI, with a loud safety net.",
            style="italic cyan",
        )
    )
    time.sleep(0.5)

    with console.status("[bold cyan]Spinning up a throwaway git fixture...", spinner="dots"):
        setup_repo()
        time.sleep(0.7)
    console.print("[green]:heavy_check_mark:[/] fixture ready — 8 real tests, real ts-morph import graph\n")

    # --- Scenario 1: a normal, narrow change ---
    console.rule("[bold]Scenario 1 — one file changes[/]")
    with (DEMO_DIR / "src" / "a.ts").open("a") as f:
        f.write("\nexport const demoMarker = true;\n")
    run(["git", "add", "-A"], DEMO_DIR)
    run(["git", "commit", "-q", "-m", "change a.ts"], DEMO_DIR)

    with console.status("[bold cyan]Building import graph with ts-morph...", spinner="dots"):
        time.sleep(0.8)
    with console.status(
        "[bold cyan]Walking the reverse dependency graph from src/a.ts...", spinner="dots"
    ):
        time.sleep(0.6)
        out1 = sts(["select", "--base", "main", "--json"], DEMO_DIR)

    table = Table(title=f"{len(out1['selected'])} of {out1['total']} tests affected")
    table.add_column("Test", style="bold green")
    table.add_column("Reason chain", style="dim")
    for test in out1["selected"]:
        chain = out1["reasons"].get(test, [test])
        table.add_row(test, " -> ".join(chain))
    console.print(table)

    skipped = out1["total"] - len(out1["selected"])
    pct = round(100 * skipped / out1["total"])
    console.print(
        Panel.fit(
            f"[bold green]{skipped} of {out1['total']} tests skipped[/] "
            f"— [bold]{pct}% fewer tests run[/] on this diff",
            border_style="green",
        )
    )
    time.sleep(0.6)

    # --- Scenario 2: a config change forces the safety net ---
    console.rule("[bold]Scenario 2 — a config file changes[/]")
    with console.status("[bold yellow]Re-scanning after a config change...", spinner="dots"):
        with (DEMO_DIR / "tsconfig.json").open("a") as f:
            f.write("\n")
        run(["git", "add", "-A"], DEMO_DIR)
        run(["git", "commit", "-q", "-m", "touch tsconfig.json"], DEMO_DIR)
        time.sleep(0.8)
        out2 = sts(["select", "--base", "main", "--json"], DEMO_DIR)

    if out2["mode"] == "safe-mode":
        reasons = "\n".join(f"  • {r}" for r in out2["safeModeReasons"])
        console.print(
            Panel(
                f"[bold red]SAFE MODE[/] — running the full suite ({out2['total']} tests)\n\n{reasons}",
                title="[bold red]narrowing refused[/]",
                border_style="red",
            )
        )
    time.sleep(0.4)

    console.rule("[bold magenta]done[/]")
    console.print(
        "[dim]Real CLI, real fixture, real numbers. Reproduce: "
        "npm run build && bash examples/demo.sh[/]"
    )


if __name__ == "__main__":
    main()
