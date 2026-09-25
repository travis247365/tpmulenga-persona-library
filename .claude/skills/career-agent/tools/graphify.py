#!/usr/bin/env python3
"""Build a weighted graph of career relationships and surface risk paths.

    graphify.py --graph corpus.json [--target "Flytxt"] [--emit cortex.json]

The point is not the picture. It is that exposures nobody thought to look for
are paths in a graph. The MTN finding in the Flytxt application was four hops:

    Flytxt -> supplies -> MTN Group -> parent_of -> MTN Mobile Money
           -> terminated -> d2c Telcare <- officer_of <- Travis

That took a human several passes to notice. Here it is a query.

Edges carry a weight in [0,1] for confidence and a free-text `evidence` field
naming where the claim comes from. An edge without evidence is an assertion,
and the report marks it as such rather than treating it as fact.
"""

import argparse
import json
import sys
from collections import deque
from pathlib import Path

# Node types that make a path worth reporting when a prospective employer
# reaches them. These are the things that embarrass you in an interview.
SENSITIVE = {
    "referee":       "a named referee sits on this path",
    "confidential":  "a client whose contract forbids naming them",
    "terminated":    "a relationship that ended badly",
    "competitor":    "a competitor of a current or recent client",
}


def load(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in data["nodes"]}
    adj = {}
    for e in data["edges"]:
        for a, b, direction in ((e["src"], e["dst"], "->"), (e["dst"], e["src"], "<-")):
            adj.setdefault(a, []).append((b, e, direction))
    missing = {x for e in data["edges"] for x in (e["src"], e["dst"])} - set(nodes)
    if missing:
        raise ValueError(f"edges reference unknown nodes: {sorted(missing)}")
    return nodes, adj, data


# Each additional hop is a further inference, so confidence decays with
# distance. Without this a four-hop chain scores the same as a direct
# supplier relationship, and the ranking stops meaning anything.
HOP_DECAY = 0.6


def paths_from(nodes, adj, start, max_hops=5):
    """Breadth-first walk to every sensitive node, shortest path wins."""
    if start not in nodes:
        raise KeyError(start)
    seen, out = {start}, []
    q = deque([(start, [], 1.0)])
    while q:
        cur, trail, conf = q.popleft()
        if len(trail) >= max_hops:
            continue
        for nxt, edge, direction in adj.get(cur, []):
            if nxt in seen:
                continue
            seen.add(nxt)
            step = (cur, edge, direction, nxt)
            w = conf * edge.get("weight", 1.0) * HOP_DECAY
            node = nodes[nxt]
            if node.get("sensitivity") in SENSITIVE:
                out.append((node, trail + [step], w))
            q.append((nxt, trail + [step], w))
    return sorted(out, key=lambda r: (-r[2], len(r[1])))


def render(nodes, results):
    if not results:
        return "No path from this target reaches a sensitive node. That is a\nclean read, not a guarantee: it is only as good as the graph.\n"
    lines = []
    for node, trail, conf in results:
        why = SENSITIVE[node["sensitivity"]]
        lines.append(f"\n{node['label']} — {why}")
        lines.append(f"  confidence {conf:.2f} over {len(trail)} hop(s)")
        for src, edge, direction, dst in trail:
            arrow = "->" if direction == "->" else "<-"
            ev = edge.get("evidence")
            tag = f"  [{ev}]" if ev else "  [ASSERTED - no evidence on file]"
            lines.append(f"    {nodes[src]['label']} {arrow}{edge['type']}{arrow} "
                         f"{nodes[dst]['label']}{tag}")
        if node.get("note"):
            lines.append(f"  note: {node['note']}")
    return "\n".join(lines) + "\n"


def _esc(v):
    """Escape a value for a Cypher single-quoted string."""
    return str(v).replace("\\", "\\\\").replace("'", "\\'")


def emit_json(nodes, data):
    return json.dumps({
        "format": "graphify/v1",
        "nodes": [
            {"id": n["id"], "type": n["type"], "label": n["label"],
             "sensitivity": n.get("sensitivity"), "note": n.get("note")}
            for n in nodes.values()
        ],
        "edges": [
            {"from": e["src"], "to": e["dst"], "type": e["type"],
             "weight": e.get("weight", 1.0), "evidence": e.get("evidence"),
             "asserted": "evidence" not in e}
            for e in data["edges"]
        ],
    }, indent=2)


def emit_cypher(nodes, data):
    """Neo4j / openCypher MERGE statements, idempotent on re-import."""
    out = ["// graphify/v1 - safe to re-run; every statement MERGEs"]
    for n in nodes.values():
        props = [f"label: '{_esc(n['label'])}'", f"kind: '{_esc(n['type'])}'"]
        if n.get("sensitivity"):
            props.append(f"sensitivity: '{_esc(n['sensitivity'])}'")
        if n.get("note"):
            props.append(f"note: '{_esc(n['note'])}'")
        out.append(f"MERGE (n:Entity {{id: '{_esc(n['id'])}'}}) SET n += {{{', '.join(props)}}};")
    for e in data["edges"]:
        rel = e["type"].upper().replace(" ", "_")
        props = [f"weight: {e.get('weight', 1.0)}",
                 f"asserted: {'false' if 'evidence' in e else 'true'}"]
        if e.get("evidence"):
            props.append(f"evidence: '{_esc(e['evidence'])}'")
        out.append(
            f"MATCH (a:Entity {{id: '{_esc(e['src'])}'}}), (b:Entity {{id: '{_esc(e['dst'])}'}}) "
            f"MERGE (a)-[r:{rel}]->(b) SET r += {{{', '.join(props)}}};")
    return "\n".join(out)


def emit_graphml(nodes, data):
    """GraphML - opens in Gephi, yEd, Cytoscape."""
    from xml.sax.saxutils import escape
    keys = [("label", "node", "string"), ("kind", "node", "string"),
            ("sensitivity", "node", "string"), ("note", "node", "string"),
            ("type", "edge", "string"), ("weight", "edge", "double"),
            ("evidence", "edge", "string"), ("asserted", "edge", "boolean")]
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">']
    for name, dom, typ in keys:
        out.append(f'  <key id="{name}" for="{dom}" attr.name="{name}" attr.type="{typ}"/>')
    out.append('  <graph edgedefault="directed">')
    for n in nodes.values():
        out.append(f'    <node id="{escape(n["id"])}">')
        for k, v in (("label", n["label"]), ("kind", n["type"]),
                     ("sensitivity", n.get("sensitivity")), ("note", n.get("note"))):
            if v:
                out.append(f'      <data key="{k}">{escape(str(v))}</data>')
        out.append("    </node>")
    for i, e in enumerate(data["edges"]):
        out.append(f'    <edge id="e{i}" source="{escape(e["src"])}" target="{escape(e["dst"])}">')
        out.append(f'      <data key="type">{escape(e["type"])}</data>')
        out.append(f'      <data key="weight">{e.get("weight", 1.0)}</data>')
        out.append(f'      <data key="asserted">{"false" if "evidence" in e else "true"}</data>')
        if e.get("evidence"):
            out.append(f'      <data key="evidence">{escape(e["evidence"])}</data>')
        out.append("    </edge>")
    out += ["  </graph>", "</graphml>"]
    return "\n".join(out)


def emit_csv(nodes, data):
    """Two CSV blocks - the lowest common denominator for any importer."""
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["# nodes"])
    w.writerow(["id", "type", "label", "sensitivity", "note"])
    for n in nodes.values():
        w.writerow([n["id"], n["type"], n["label"],
                    n.get("sensitivity", ""), n.get("note", "")])
    w.writerow([])
    w.writerow(["# edges"])
    w.writerow(["src", "dst", "type", "weight", "evidence", "asserted"])
    for e in data["edges"]:
        w.writerow([e["src"], e["dst"], e["type"], e.get("weight", 1.0),
                    e.get("evidence", ""), "evidence" not in e])
    return buf.getvalue()


EMITTERS = {"json": emit_json, "cypher": emit_cypher,
            "graphml": emit_graphml, "csv": emit_csv}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph", required=True)
    ap.add_argument("--target", help="node id to trace exposures from")
    ap.add_argument("--max-hops", type=int, default=5)
    ap.add_argument("--emit", help="write the graph here")
    ap.add_argument("--format", choices=sorted(EMITTERS), default="json",
                    help="output format (default: json)")
    a = ap.parse_args()

    try:
        nodes, adj, data = load(a.graph)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"graph is not usable: {exc}", file=sys.stderr)
        return 2

    if a.emit:
        Path(a.emit).write_text(EMITTERS[a.format](nodes, data))
        print(f"wrote {a.emit} as {a.format}: "
              f"{len(nodes)} nodes, {len(data['edges'])} edges")

    if a.target:
        try:
            results = paths_from(nodes, adj, a.target, a.max_hops)
        except KeyError:
            print(f"no node with id {a.target!r}", file=sys.stderr)
            return 2
        print(f"Exposure paths from {nodes[a.target]['label']}:")
        print(render(nodes, results))
        return 1 if results else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
