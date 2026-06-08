#!/usr/bin/env python3
"""Tier-2 step 2: generate a labeled auto-summary for each PDF-only article via
the Claude API, caching by article id (run once). Resumable.

Reads the cleaned PDF text from scripts/cc/pdfcache/<safe>.json, calls the Claude
API for a 150-250 word plain-language summary + 3-5 key findings, and writes the
result back into the same cache file under "summary" + "findings".

Requires ANTHROPIC_API_KEY in the environment. Model via CC_SUMMARY_MODEL
(default claude-haiku-4-5 — economical for ~1.5k bulk summaries; override to
claude-opus-4-8 / claude-sonnet-4-6 for higher quality).

  ANTHROPIC_API_KEY=... python scripts/cc/summarize.py [--limit N]
"""
import json, os, sys, glob, time

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "pdfcache")
MODEL = os.environ.get("CC_SUMMARY_MODEL", "claude-haiku-4-5")
LIMIT = None
if "--limit" in sys.argv:
    LIMIT = int(sys.argv[sys.argv.index("--limit") + 1])

import anthropic

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string",
                    "description": "150-250 word plain-language summary of the article"},
        "key_findings": {"type": "array", "items": {"type": "string"},
                         "description": "3-5 concise key findings"},
    },
    "required": ["summary", "key_findings"],
}

SYS = ("You are a scientific editor. Given the extracted text of a microbiology "
       "research article, write a faithful, plain-language summary. Do not invent "
       "findings not supported by the text. Be precise about organisms, methods, "
       "and conclusions. 150-250 words for the summary; 3-5 short key findings.")

def summarize(text):
    text = text[:30000]
    resp = client.messages.create(
        model=MODEL,
        max_tokens=1500,
        system=SYS,
        messages=[{"role": "user", "content":
                   f"Summarize this article:\n\n{text}"}],
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
    )
    out = ""
    for b in resp.content:
        if b.type == "text":
            out += b.text
    return json.loads(out)

def main():
    files = sorted(glob.glob(CACHE + "/*.json"))
    todo = []
    for f in files:
        d = json.load(open(f))
        if d.get("summary"):
            continue
        if not d.get("text") or len(d["text"]) < 200:
            continue  # scanned/empty — no OCR available; skip
        todo.append(f)
    if LIMIT:
        todo = todo[:LIMIT]
    print(f"to summarize: {len(todo)} (model={MODEL})")
    done = err = 0
    for i, f in enumerate(todo):
        d = json.load(open(f))
        try:
            res = summarize(d["text"])
            d["summary"] = res["summary"]
            d["findings"] = res.get("key_findings", [])
            d["summary_model"] = MODEL
            json.dump(d, open(f, "w"))
            done += 1
        except Exception as e:
            err += 1
            print(f"  ERR {d['slug']}: {e.__class__.__name__}: {str(e)[:120]}")
            if "authentication" in str(e).lower() or "401" in str(e):
                print("  -> ANTHROPIC_API_KEY missing/invalid; aborting.")
                break
        if (i + 1) % 25 == 0:
            print(f"  {i+1}/{len(todo)} done={done} err={err}")
    print(f"summaries: done={done} err={err}")

if __name__ == "__main__":
    main()
