"""Run the refund cases and print how many matched. Reviewed manually before release."""
import json
from pathlib import Path

from northstar.agent import run

cases = [json.loads(line) for line in Path(__file__).with_name("refund_cases.jsonl").read_text().splitlines()]
matched = 0
for case in cases:
    result = run(case["input"])
    calls = [c["name"] for m in result["messages"] for c in getattr(m, "tool_calls", [])]
    matched += (case["expected_tool"] in calls) if case["expected_tool"] else (not calls)
print(f"{matched}/{len(cases)} cases matched")
