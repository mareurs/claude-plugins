// cost.mjs — the S5 cost rule for a run that printed no cost (ruling R148), shared by the batch's stop rule (run.mjs) and the analysis
// (analyze.mjs) so that the two cannot disagree. Pure: no file, no clock, no model.
//
// A timed-out agent is SIGKILLed with its container and prints no JSON, so its Row has costUsd null although it used the whole wall clock at
// the highest effort; an interrupted one is the same. Summed as 0 they hide the most expensive runs of the study. So a Row with no KNOWN cost
// that reached the container and timed out (exit.timedOut), or ended infra `interrupted`, counts as the LARGEST costUsd known in the rows
// given (0 when none is known). No price table is invented.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The cost of one Row that is KNOWN: the stdout JSON's total_cost_usd, a number >= 0 (0 is a measurement); null otherwise.
export const knownCost = (row) => (isObject(row) && Number.isFinite(row.costUsd) && row.costUsd >= 0 ? row.costUsd : null);

// A Row with no known cost whose run used a container to the end of its time or until a signal cut it off. Not estimated: a run_failed row
// (exit null: it never reached a container), a null cost without a timeout or a signal, and the exhausted line written WITHOUT an attempt
// (noAttempt: the cost of that attempt is in its own line). An exhausted line that is an attempt's own line (lastInfra interrupted) is
// estimated like the attempt's row would be.
export const isEstimated = (row) => isObject(row) && knownCost(row) === null && row.noAttempt !== true
  && (row.exit?.timedOut === true || row.infra === 'interrupted' || row.lastInfra === 'interrupted');

// The largest known cost among `rows`; 0 when none is known.
export const largestKnownCost = (rows) => rows.reduce((largest, row) => Math.max(largest, knownCost(row) ?? 0), 0);

// The cost the stop rule sees over `rows`: the known costs, plus, for each estimated row, the largest known cost among the rows.
// -> { costUsd, estimatedRows, largest }.
export const costOf = (rows) => {
  let known = 0;
  let estimatedRows = 0;
  for (const row of rows) {
    const cost = knownCost(row);
    if (cost !== null) known += cost;
    else if (isEstimated(row)) estimatedRows += 1;
  }
  const largest = largestKnownCost(rows);
  return { costUsd: known + estimatedRows * largest, estimatedRows, largest };
};
