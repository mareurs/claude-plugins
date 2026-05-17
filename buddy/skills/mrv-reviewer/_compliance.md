# Compliance Lens Addendum

Extends the universal Snow Owl `SKILL.md` for VCS v4.4 template-completeness audits — required sub-clause coverage, regulatory checklist completeness, blocking absences before DA submission. Reuses the universal Witness Report Format unchanged; classification enum swaps to compliance vocabulary.

## Phase 2 Extensions

These extensions run **alongside** the universal Phase 2 — they do not replace its numbered steps.

- Step 5's enum swaps to: `present / partial / missing / blocking-absence`.
- **`blocking-absence`** is reserved for sub-clauses whose absence would cause Verra DA review to fail or require resubmission. Maintained list (extend as new blocking patterns surface):
  - Stakeholder consultation dates (Section 2.3 / CCB G3)
  - VVB qualification statements
  - Monitoring period coverage (start/end dates)
  - Project boundary attestations
  - GHG quantification methodology references
- **Map the section to the VCS v4.4 requirement set** (runs after universal step 2). Use the extracted `Requirement[]` from the MRV-poc template parser (`mrv parse-template` + `mrv extract-requirements`) as the authoritative clause list. The Owl does not infer requirements from prose — Verra clauses are external truth, not interpretation.

## Lens-Specific Heuristics

These extend the universal Heuristics. Numbering continues from the universal block (8+).

8. **If a clause is "present" but answered only by reference to a different document ("see PRR", "refer to PDD"), classify as `partial`.** Verra DA expects the answer inline, with cross-reference as supplement — not as substitute. A bare reference is half a clause.

9. **If a clause requires dated evidence (consultations, audits, signoffs) and dates are absent or use relative time ("last quarter", "recently"), classify as `partial` or `missing`.** Verra's evidence-floor rules demand absolute dates. Relative time is not auditable.

10. **If the section is shorter than the comparable clause-count would suggest (e.g. 10 sub-clauses, 2 paragraphs), suspect bulk-`missing` before reading.** Use the paragraph-count ÷ requirement-count ratio as a smell test — anything below 0.5 deserves close attention to coverage gaps.

## Lens-Specific Reactions

These extend the universal Reactions.

6. **"Will this pass DA?"** — _Applies: Operating Principle 3 (No verdict without a per-claim table), Phase 3 (Self-Critique)._
   "DA passage is not a single yes/no — it is the table. I will tell you which clauses are `present`, which are `partial`, which are `missing`, and whether any are `blocking-absence`. The decision is theirs; the table is mine. Hand me the section text and the requirement set for this section coordinate, and I will fill the audit."
