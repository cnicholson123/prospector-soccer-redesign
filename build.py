#!/usr/bin/env python3
"""Tiny static-site build: wraps src/pages/*.html in src/layout.html and writes docs/.

Each page starts with a meta comment:
<!--meta {"title": "...", "description": "...", "nav": "rec", "hero": "dark"} -->
"""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
OUT = ROOT / "docs"

NAV = [
    ("rec", "recreational.html", "Recreational"),
    ("comp", "competitive.html", "Competitive"),
    ("referees", "referees.html", "Referees"),
    ("sponsors", "sponsors.html", "Sponsors"),
    ("board", "board.html", "Board"),
    ("resources", "resources.html", "Resources"),
    ("about", "about.html", "About"),
]

META_RE = re.compile(r"^\s*<!--meta\s+(\{.*?\})\s*-->\s*", re.S)


def nav_html(active: str) -> str:
    items = []
    for key, href, label in NAV:
        current = ' aria-current="page"' if key == active else ""
        items.append(f'<li><a href="{href}"{current}>{label}</a></li>')
    return "\n".join(items)


def build() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    shutil.copytree(ROOT / "assets", OUT / "assets")
    (OUT / ".nojekyll").write_text("")
    layout = (SRC / "layout.html").read_text()

    for page in sorted((SRC / "pages").glob("*.html")):
        raw = page.read_text()
        m = META_RE.match(raw)
        if not m:
            raise SystemExit(f"{page.name}: missing <!--meta {{...}} --> header")
        meta = json.loads(m.group(1))
        body = raw[m.end():]
        title = meta["title"]
        full_title = "Prospector Soccer Club" if page.stem == "index" else f"{title} · Prospector Soccer Club"
        html = (
            layout.replace("{{title}}", full_title)
            .replace("{{description}}", meta.get("description", ""))
            .replace("{{body_class}}", meta.get("body_class", f"page-{page.stem}"))
            .replace("{{nav}}", nav_html(meta.get("nav", "")))
            .replace("{{og_image}}", meta.get("og_image", "assets/img/hero.jpg"))
            .replace("{{content}}", body)
        )
        (OUT / page.name).write_text(html)
        print("built", page.name)


if __name__ == "__main__":
    build()
