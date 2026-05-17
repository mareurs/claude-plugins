# Output Lens Addendum

Extends the universal Snow Owl `SKILL.md` for output-integrity audits — LLM-generated MR section text, retrieval pool quality, pipeline provenance, and hallucination detection. Reuses the universal Witness Report Format unchanged.

## Phase 2 Extensions

These extensions run **alongside** the universal Phase 2 — they do not replace its numbered steps.

- Step 5's enum stays: `grounded | partially-grounded | unsupported | hallucinated`.
- **Verify chunk_id liveness** before quoting evidence (runs between universal step 4 and step 5). Confirm the chunk_id exists in the live ChromaDB store. If not present, classify as `hallucinated` — the writer cited a phantom chunk. (MRV-poc parallel: T11 consume-time identity check was added for the same class of failure on the eval side.)
- **Triangulate against the `candidate_pool`** when retrieval audit is the subject (runs alongside universal step 5). The question is not "did the writer cite X?" but "was X retrievable at all?" If gold-grade chunks are absent from the pool, the failure is upstream of generation — refer to the Pheasant (:llm) for the retrieval audit before declaring generation guilty.

## Lens-Specific Heuristics

These extend the universal Heuristics. Numbering continues from the universal block (8+).

8. **If the writer's chunk citations all map to chunks at the top of the candidate_pool, the retrieval is sufficient but generation may be conservative.** The writer is taking the highest-confidence chunks and stitching prose. This is safe but may miss broader context. Flag for breadth review.

9. **If the writer cites mid- or low-ranked chunks frequently, the reranker may be under-confident.** Cross-reference with the rerank_score distribution — calibrated rerankers concentrate evidence at the top; flat distributions suggest the reranker is not discriminating, and generation has to do extra work.

10. **If multiple consecutive claims cite the same chunk_id, the writer may be stitching one chunk's prose rather than synthesizing.** The same chunk being the sole source for three+ claims is a single-anchor pattern — verify the chunk actually contains all three claims (Heuristic 4 applies per-claim) and that the section is not over-reliant on one source.

## Lens-Specific Reactions

These extend the universal Reactions.

6. **"Why is generation getting this wrong?"** — _Applies: Phase 1 (Locate), Phase 2 (Compare)._
   "Show me the source_chunks the writer was handed and the generated text. The audit will tell us whether the gap was retrieval (chunk absent from pool), reranking (chunk present but low-ranked, so writer ignored it), or generation (chunk present, well-ranked, but misread or paraphrased). Each diagnosis routes to a different next step — Pheasant (:llm) for retrieval, reranker tuning for ranking, Hamsa for writer prompt."
