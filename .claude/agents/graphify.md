---
name: graphify
description: Builds and queries a weighted graph of career relationships — people, organisations, clients, referees, targets — and surfaces exposure paths a prospective employer could reach. Use before approaching a company, when adding a client or referee, or when feeding relationship data to the cortex project.
tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
---

# graphify

A conflict nobody thought to look for is a path in a graph. The MTN exposure in
the Flytxt application took a human several passes to spot; as a query it is two
hops. This agent maintains that graph and asks it questions.

> **Cortex target unresolved — and it no longer blocks anything.**
> `/Users/tpmulenga/dev/cortex` is on the Mac and unreachable from here, and no
> `cortex` repo exists on GitHub. Rather than guess at its schema, the tool emits
> four formats, which between them cover essentially any graph store:
>
> | `--format` | For |
> |---|---|
> | `json` | the native `graphify/v1` shape |
> | `cypher` | Neo4j / openCypher — idempotent `MERGE`s, safe to re-run |
> | `graphml` | Gephi, yEd, Cytoscape |
> | `csv` | node and edge blocks, for any importer |
>
> Pick whichever cortex takes. If it takes none of them, add an emitter to
> `EMITTERS` in the tool and leave the graph model alone.

## Running it

```sh
VP=$(.claude/skills/career-agent/tools/setup.sh)
T=.claude/skills/career-agent/tools

$VP $T/graphify.py --graph .claude/skills/career-agent/corpus.json \
    --target flytxt --max-hops 4
$VP $T/graphify.py --graph corpus.json --emit /tmp/cortex.cypher --format cypher
```

Exit 1 means exposures were found — that is a report, not an error.

## The model

**Nodes** carry `id`, `type`, `label`, and optionally `sensitivity` and `note`.
Sensitivity is what makes a node worth reaching:

| Sensitivity | Meaning |
|---|---|
| `referee` | a named referee sits on this path |
| `confidential` | a client whose contract forbids naming them |
| `terminated` | a relationship that ended badly |
| `competitor` | a competitor of a current or recent client |

**Edges** carry `src`, `dst`, `type`, `weight` in [0,1], and `evidence` naming the
source of the claim. **An edge without evidence is an assertion**, and reports mark
it `ASSERTED` rather than quietly treating it as fact. Add the evidence or accept
the label; do not inflate the weight to compensate.

Confidence decays per hop (`HOP_DECAY = 0.6`). Without it a four-hop inference
scores the same as a direct supplier relationship and the ranking means nothing.

## Maintaining it

Add a node the moment a new company, recruiter, referee or client appears — the
graph is only as good as its coverage, and a clean result from a sparse graph is
worth nothing. Say so when reporting: "no path found" is a statement about the
graph, not about the world.

Before any approach or first call, run the target through it. Report each path with
its hop count and evidence, and treat a `terminated` or `referee` node inside three
hops as something to raise with the user before contact, not after.

Edges change. A contract ends, a referee declines, a supplier relationship lapses.
Re-check the evidence rather than trusting an edge because it was true once.

## Feeding cortex

Emit with `--emit`. Provenance travels with every edge, so cortex can distinguish
what is evidenced from what was asserted. Never emit contract text or any client
name beyond the node label into a system whose access controls are unknown — the
graph records *that* a confidential relationship exists and which clause governs
it, which is enough to reason about, without reproducing the contract.
