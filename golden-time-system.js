/* Golden Time game system. UI-independent and safe to import from a browser or Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GoldenTimeSystem = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = 1;
  const DEFAULTS = Object.freeze({
    days: 5,
    startingBudget: 3000,
    scoreMax: 100,
    initialScores: Object.freeze({ integrity: 0, economicDefense: 0, innovation: 0, budgetPerformance: 0 }),
    weights: Object.freeze({ integrity: 0.25, economicDefense: 0.25, innovation: 0.25, budgetPerformance: 0.25 }),
    grades: Object.freeze([
      Object.freeze({ min: 90, grade: "A", title: "탁월한 업무 성과" }),
      Object.freeze({ min: 80, grade: "B", title: "우수한 업무 성과" }),
      Object.freeze({ min: 70, grade: "C", title: "양호한 업무 성과" }),
      Object.freeze({ min: 60, grade: "D", title: "보통 업무 성과" }),
      Object.freeze({ min: 0, grade: "F", title: "업무 성과 개선 필요" })
    ])
  });

  // These four metrics alone determine the score and grade. Disaster progress
  // is tracked separately as player-facing situation information.
  const SCORE_KEYS = ["integrity", "economicDefense", "innovation", "budgetPerformance"];
  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = (value, name) => {
    if (!Number.isFinite(value)) throw new TypeError(name + " must be a finite number");
    return value;
  };
  const configWith = overrides => {
    const c = { ...DEFAULTS, ...overrides };
    c.initialScores = { ...DEFAULTS.initialScores, ...(overrides && overrides.initialScores) };
    const weights = { ...DEFAULTS.weights, ...(overrides && overrides.weights) };
    for (const key of SCORE_KEYS) {
      finite(weights[key], "weights." + key);
      if (weights[key] < 0) throw new RangeError("weights." + key + " must not be negative");
    }
    const weightTotal = SCORE_KEYS.reduce((sum, key) => sum + weights[key], 0);
    if (weightTotal <= 0) throw new RangeError("At least one score weight must be greater than zero");
    c.weights = Object.fromEntries(SCORE_KEYS.map(key => [key, weights[key] / weightTotal]));
    c.grades = overrides && overrides.grades ? overrides.grades : DEFAULTS.grades;
    if (!Number.isInteger(c.days) || c.days < 1) throw new RangeError("days must be a positive integer");
    finite(c.startingBudget, "startingBudget");
    finite(c.scoreMax, "scoreMax");
    return c;
  };

  function createState(options) {
    const config = configWith(options);
    return {
      version: VERSION,
      rules: {
        scoreMax: config.scoreMax,
        initialScores: clone(config.initialScores),
        weights: clone(config.weights),
        grades: clone(config.grades)
      },
      day: 1,
      days: config.days,
      budget: config.startingBudget,
      initialBudget: config.startingBudget,
      scores: Object.fromEntries(SCORE_KEYS.map(k => [k, config.initialScores[k]])),
      integrityStats: { correct: 0, ordinaryWrong: 0, falseApprovals: 0 },
      economicDefenseStats: { events: 0, totalScore: 0 },
      innovationStats: { decisions: 0, totalScore: 0 },
      budgetStats: { allocatedTotal: 0, weightedScoreTotal: 0 },
      disaster: { active: false, progress: 0, status: "재난 발생 전", metrics: {} },
      history: [],
      dailyResults: [],
      pendingMorningOutcomes: [],
      playTimeMs: 0,
      rankingSubmitted: false,
      finished: false
    };
  }

  // Apply a team member's result as one atomic, immutable update. Deltas may be
  // negative; budgetDelta is signed (spending is negative, returned funds positive).
  function applyOutcome(state, outcome, options) {
    if (!state || state.version !== VERSION) throw new TypeError("Invalid Golden Time state");
    if (state.finished) throw new Error("The game is already finished");
    const config = configWith({ ...(state.rules || {}), ...options, days: state.days, startingBudget: state.initialBudget });
    const result = outcome || {};
    const budgetDelta = finite(result.budgetDelta ?? 0, "budgetDelta");
    const deltas = result.scoreDeltas || {};
    const integrityDecision = result.integrityDecision;
    if (integrityDecision !== undefined && !["correct", "ordinaryWrong", "falseApproval"].includes(integrityDecision)) {
      throw new TypeError("integrityDecision must be correct, ordinaryWrong, or falseApproval");
    }
    if (integrityDecision !== undefined && deltas.integrity !== undefined) {
      throw new TypeError("Pass integrityDecision instead of scoreDeltas.integrity");
    }
    if (integrityDecision === undefined && finite(deltas.integrity ?? 0, "scoreDeltas.integrity") !== 0) {
      throw new TypeError("Integrity score is calculated from integrityDecision");
    }
    const economicDecision = result.economicDecision;
    if (economicDecision !== undefined && deltas.economicDefense !== undefined) {
      throw new TypeError("Pass economicDecision instead of scoreDeltas.economicDefense");
    }
    if (economicDecision === undefined && finite(deltas.economicDefense ?? 0, "scoreDeltas.economicDefense") !== 0) {
      throw new TypeError("Economic defense score is calculated from economicDecision");
    }
    const innovationDecision = result.innovationDecision;
    if (innovationDecision !== undefined && deltas.innovation !== undefined) {
      throw new TypeError("Pass innovationDecision instead of scoreDeltas.innovation");
    }
    if (innovationDecision === undefined && finite(deltas.innovation ?? 0, "scoreDeltas.innovation") !== 0) {
      throw new TypeError("Innovation score is calculated from innovationDecision");
    }
    if (result.budgetAssessment !== undefined && deltas.budgetPerformance !== undefined) {
      throw new TypeError("Pass budgetAssessment instead of scoreDeltas.budgetPerformance");
    }
    if (result.budgetAssessment === undefined && finite(deltas.budgetPerformance ?? 0, "scoreDeltas.budgetPerformance") !== 0) {
      throw new TypeError("Budget performance score is calculated from budgetAssessment");
    }
    const budgetAssessment = result.budgetAssessment;
    let budgetEventScore = null;
    let budgetWeight = 0;
    if (budgetAssessment !== undefined) {
      const allocatedBudget = finite(budgetAssessment.allocatedBudget, "budgetAssessment.allocatedBudget");
      const actualCost = finite(budgetAssessment.actualCost, "budgetAssessment.actualCost");
      const fulfillment = finite(budgetAssessment.fulfillment, "budgetAssessment.fulfillment");
      if (allocatedBudget <= 0) throw new RangeError("budgetAssessment.allocatedBudget must be greater than zero");
      if (actualCost < 0) throw new RangeError("budgetAssessment.actualCost must not be negative");
      if (fulfillment < 0 || fulfillment > 1) throw new RangeError("budgetAssessment.fulfillment must be between 0 and 1");
      const costEfficiency = actualCost === 0 ? 1 : Math.min(1, allocatedBudget / actualCost);
      budgetEventScore = Math.round(fulfillment * costEfficiency * 10000) / 100;
      budgetWeight = allocatedBudget;
    }
    const budgetStats = { ...(state.budgetStats || { allocatedTotal: 0, weightedScoreTotal: 0 }) };
    if (budgetEventScore !== null) {
      budgetStats.allocatedTotal += budgetWeight;
      budgetStats.weightedScoreTotal += budgetWeight * budgetEventScore;
    }
    const innovationValues = { success: 1, partial: 0.5, failure: 0 };
    if (innovationDecision !== undefined && !Object.prototype.hasOwnProperty.call(innovationValues, innovationDecision)) {
      throw new TypeError("innovationDecision must be success, partial, or failure");
    }
    const innovationStats = { ...(state.innovationStats || { decisions: 0, totalScore: 0 }) };
    if (innovationDecision !== undefined) {
      innovationStats.decisions += 1;
      innovationStats.totalScore += innovationValues[innovationDecision] * 100;
    }
    let eventEconomicScore = null;
    let economicComponents = null;
    if (economicDecision !== undefined) {
      for (const key of ["requiredQuantity", "availableQuantity", "referenceUnitCost", "actualTotalCost"]) {
        const value = finite(economicDecision[key], "economicDecision." + key);
        if (value < 0) throw new RangeError("economicDecision." + key + " must not be negative");
      }
      const marketResponse = economicDecision.marketResponse || classifyMarketResponse(
        economicDecision.chosenExpectedCost,
        economicDecision.bestFeasibleExpectedCost
      );
      const marketResponseValues = { success: 1, partial: 0.5, failure: 0 };
      if (!Object.prototype.hasOwnProperty.call(marketResponseValues, marketResponse)) {
        throw new TypeError("Provide marketResponse or chosenExpectedCost and bestFeasibleExpectedCost");
      }
      economicComponents = calculateEconomicComponents(economicDecision);
      economicComponents.marketResponse = marketResponse;
      eventEconomicScore = Math.round((marketResponseValues[marketResponse] * 50 + economicComponents.supplyFulfillment * 30 + economicComponents.budgetEfficiency * 20) * 100) / 100;
    }
    const economicDefenseStats = { ...(state.economicDefenseStats || { events: 0, totalScore: 0 }) };
    if (eventEconomicScore !== null) {
      economicDefenseStats.events += 1;
      economicDefenseStats.totalScore += eventEconomicScore;
    }
    const integrityStats = { ...(state.integrityStats || { correct: 0, ordinaryWrong: 0, falseApprovals: 0 }) };
    if (integrityDecision === "correct") integrityStats.correct += 1;
    if (integrityDecision === "ordinaryWrong") integrityStats.ordinaryWrong += 1;
    if (integrityDecision === "falseApproval") integrityStats.falseApprovals += 1;
    const scores = { ...state.scores };
    for (const key of SCORE_KEYS) {
      const delta = key === "integrity" ? 0 : finite(deltas[key] ?? 0, "scoreDeltas." + key);
      scores[key] = Math.max(0, Math.min(config.scoreMax, scores[key] + delta));
    }
    if (integrityDecision !== undefined) scores.integrity = calculateIntegrityScore(integrityStats, config.initialScores.integrity);
    if (eventEconomicScore !== null) scores.economicDefense = calculateEconomicDefenseScore(economicDefenseStats, config.initialScores.economicDefense);
    if (innovationDecision !== undefined) scores.innovation = calculateInnovationScore(innovationStats, config.initialScores.innovation);
    if (budgetEventScore !== null) scores.budgetPerformance = calculateBudgetPerformanceScore(budgetStats, config.initialScores.budgetPerformance);
    if (result.disasterProgressDelta !== undefined) {
      throw new TypeError("Use disasterMetrics instead of disasterProgressDelta");
    }
    let disaster = state.disaster;
    if (result.disasterMetrics !== undefined || result.disasterStatus !== undefined) {
      const metrics = { ...(state.disaster.metrics || {}) };
      for (const metric of result.disasterMetrics || []) {
        if (!metric || typeof metric.id !== "string" || metric.id.length === 0) throw new TypeError("Each disaster metric requires an id");
        const previous = metrics[metric.id];
        const targetValue = metric.target ?? (previous && previous.target);
        if (targetValue === undefined) throw new TypeError("A new disaster metric must include its target");
        const target = finite(targetValue, "disasterMetrics.target");
        const achieved = finite(metric.achieved, "disasterMetrics.achieved");
        const weight = finite(metric.weight ?? (previous && previous.weight) ?? 1, "disasterMetrics.weight");
        if (target <= 0 || achieved < 0 || weight <= 0) throw new RangeError("Disaster metric target and weight must be positive; achieved must not be negative");
        metrics[metric.id] = { id: metric.id, target, achieved, weight, label: String(metric.label || (previous && previous.label) || metric.id) };
      }
      disaster = {
        ...state.disaster,
        metrics,
        progress: calculateDisasterProgress(Object.values(metrics)),
        status: result.disasterStatus === undefined ? state.disaster.status : String(result.disasterStatus)
      };
    }
    const entry = {
      day: state.day,
      source: String(result.source || "gameplay"),
      label: String(result.label || "업무 결과"),
      budgetDelta,
      scoreDeltas: Object.fromEntries(SCORE_KEYS.map(k => [k, finite(deltas[k] ?? 0, "scoreDeltas." + k)])),
      integrityDecision: integrityDecision || null,
      economicDecision: economicDecision === undefined ? null : clone(economicDecision),
      economicComponents,
      economicDecisionScore: eventEconomicScore,
      innovationDecision: innovationDecision || null,
      budgetAssessment: budgetAssessment === undefined ? null : clone(budgetAssessment),
      budgetEventScore,
      disasterMetrics: result.disasterMetrics === undefined ? null : clone(result.disasterMetrics),
      details: result.details === undefined ? null : clone(result.details)
    };
    return { ...state, budget: state.budget + budgetDelta, scores, integrityStats, economicDefenseStats, innovationStats, budgetStats, disaster, history: [...state.history, entry] };
  }

  // Ordinary errors receive no credit. A false approval of an unqualified
  // supplier counts as one additional error, doubling its penalty.
  function calculateIntegrityScore(stats, noDecisionScore) {
    const correct = stats.correct || 0;
    const ordinaryWrong = stats.ordinaryWrong || 0;
    const falseApprovals = stats.falseApprovals || 0;
    const total = correct + ordinaryWrong + falseApprovals;
    if (total === 0) return noDecisionScore === undefined ? 50 : noDecisionScore;
    return Math.max(0, Math.min(100, Math.round(100 * (correct - falseApprovals) / total)));
  }

  // Each assessed market event contributes a weighted score out of 100.
  function calculateEconomicDefenseScore(stats, noDecisionScore) {
    const events = stats.events || 0;
    if (events === 0) return noDecisionScore === undefined ? 50 : noDecisionScore;
    return Math.round((stats.totalScore / events) * 100) / 100;
  }

  function calculateInnovationScore(stats, noDecisionScore) {
    const decisions = stats.decisions || 0;
    if (decisions === 0) return noDecisionScore === undefined ? 50 : noDecisionScore;
    return Math.round(stats.totalScore / decisions);
  }

  function calculateBudgetPerformanceScore(stats, noAssessmentScore) {
    const allocated = stats.allocatedTotal || 0;
    if (allocated === 0) return noAssessmentScore === undefined ? 50 : noAssessmentScore;
    return Math.round(stats.weightedScoreTotal / allocated);
  }

  function calculateDisasterProgress(metrics) {
    const list = metrics || [];
    if (list.length === 0) return 0;
    let weightedCompletion = 0;
    let totalWeight = 0;
    for (const metric of list) {
      const target = finite(metric.target, "metric.target");
      const achieved = finite(metric.achieved, "metric.achieved");
      const weight = finite(metric.weight ?? 1, "metric.weight");
      if (target <= 0 || achieved < 0 || weight <= 0) throw new RangeError("Disaster metric target and weight must be positive; achieved must not be negative");
      weightedCompletion += Math.min(achieved / target, 1) * weight;
      totalWeight += weight;
    }
    return Math.round((weightedCompletion / totalWeight) * 10000) / 100;
  }

  // Quantities are expressed in equivalent units of the scenario's required
  // material. Existing stock and certified substitutes may count as available.
  function calculateEconomicComponents(decision) {
    const required = decision.requiredQuantity;
    const available = decision.availableQuantity;
    const fulfilled = Math.min(required, available);
    const supplyFulfillment = required === 0 ? 1 : Math.max(0, Math.min(1, available / required));
    let budgetEfficiency;
    if (required === 0) {
      budgetEfficiency = 1;
    } else if (fulfilled === 0) {
      budgetEfficiency = 0;
    } else {
      const referenceCost = fulfilled * decision.referenceUnitCost;
      budgetEfficiency = referenceCost === 0
        ? (decision.actualTotalCost === 0 ? 1 : 0)
        : Math.max(0, Math.min(1, 1 - decision.actualTotalCost / (2 * referenceCost)));
    }
    return {
      supplyFulfillment: Math.round(supplyFulfillment * 10000) / 10000,
      budgetEfficiency: Math.round(budgetEfficiency * 10000) / 10000
    };
  }

  // Risk-adjusted plan cost: purchase/production, holding, expected stockout,
  // and obsolescence costs. For a wait plan, acquisitionCost is its forecasted
  // future purchase cost; shortage probability and impact come from the scenario.
  function calculateExpectedPlanCost(plan) {
    const data = plan || {};
    const acquisitionCost = finite(data.acquisitionCost ?? 0, "acquisitionCost");
    const holdingCost = finite(data.holdingCost ?? 0, "holdingCost");
    const shortageQuantity = finite(data.shortageQuantity ?? 0, "shortageQuantity");
    const shortageProbability = finite(data.shortageProbability ?? 0, "shortageProbability");
    const shortageImpactPerUnit = finite(data.shortageImpactPerUnit ?? 0, "shortageImpactPerUnit");
    const obsolescenceCost = finite(data.obsolescenceCost ?? 0, "obsolescenceCost");
    if ([acquisitionCost, holdingCost, shortageQuantity, shortageImpactPerUnit, obsolescenceCost].some(v => v < 0)) {
      throw new RangeError("Plan costs and quantities must not be negative");
    }
    if (shortageProbability < 0 || shortageProbability > 1) throw new RangeError("shortageProbability must be between 0 and 1");
    return acquisitionCost + holdingCost + shortageQuantity * shortageProbability * shortageImpactPerUnit + obsolescenceCost;
  }

  // Compare the player's selected feasible plan with the best feasible plan.
  function classifyMarketResponse(chosenExpectedCost, bestFeasibleExpectedCost, tolerances) {
    const chosen = finite(chosenExpectedCost, "chosenExpectedCost");
    const best = finite(bestFeasibleExpectedCost, "bestFeasibleExpectedCost");
    if (chosen < 0 || best < 0) throw new RangeError("Expected plan costs must not be negative");
    const limits = { success: 0.05, partial: 0.25, ...(tolerances || {}) };
    if (chosen <= best * (1 + limits.success)) return "success";
    if (chosen <= best * (1 + limits.partial)) return "partial";
    return "failure";
  }

  // Reorder-point style plan: cover demand during replenishment lead time plus
  // scenario-set safety stock, while honoring committed stock and protected funds.
  function calculateReplenishmentPlan(input) {
    const data = input || {};
    const fields = ["forecastDailyDemand", "leadTimeDays", "safetyStock", "onHand", "onOrder", "committedQuantity", "budget", "protectedBudget", "unitCost"];
    for (const field of fields) {
      finite(data[field] ?? 0, field);
      if ((data[field] ?? 0) < 0) throw new RangeError(field + " must not be negative");
    }
    if ((data.unitCost ?? 0) === 0) throw new RangeError("unitCost must be greater than zero");
    const targetStock = Math.ceil((data.forecastDailyDemand || 0) * (data.leadTimeDays || 0) + (data.safetyStock || 0));
    const stockPosition = (data.onHand || 0) + (data.onOrder || 0) - (data.committedQuantity || 0);
    const replenishmentNeed = Math.max(0, targetStock - stockPosition);
    const spendableBudget = Math.max(0, (data.budget || 0) - (data.protectedBudget || 0));
    const affordableQuantity = Math.floor(spendableBudget / data.unitCost);
    return {
      targetStock,
      stockPosition,
      replenishmentNeed,
      spendableBudget,
      affordableQuantity,
      plannedPurchaseQuantity: Math.min(replenishmentNeed, affordableQuantity)
    };
  }

  // Called by the disaster/events module when the earthquake begins. This
  // changes player-facing context only; disaster.progress never enters scoring.
  function beginDisaster(state, status, objectives) {
    if (!state || state.version !== VERSION) throw new TypeError("Invalid Golden Time state");
    if (state.disaster.active) throw new Error("Disaster mode has already started");
    const source = objectives || Object.values(state.disaster.metrics || {});
    const metrics = {};
    for (const objective of source) {
      if (!objective || typeof objective.id !== "string" || objective.id.length === 0) throw new TypeError("Each disaster objective requires an id");
      if (metrics[objective.id]) throw new Error("Disaster objective ids must be unique");
      const target = finite(objective.target, "objective.target");
      const weight = finite(objective.weight ?? 1, "objective.weight");
      const achieved = finite(objective.achieved ?? 0, "objective.achieved");
      if (target <= 0 || weight <= 0 || achieved < 0) throw new RangeError("Disaster objective target and weight must be positive; achieved must not be negative");
      metrics[objective.id] = { id: objective.id, target, achieved, weight, label: String(objective.label || objective.id) };
    }
    return {
      ...state,
      disaster: {
        ...state.disaster,
        active: true,
        status: String(status || "대형 지진 발생"),
        metrics,
        progress: calculateDisasterProgress(Object.values(metrics))
      }
    };
  }

  // Called by the news/event module after settlement to store structured effects
  // for the next morning. This function does not generate news text or UI.
  function queueMorningOutcome(state, outcome, id) {
    if (!state || state.version !== VERSION) throw new TypeError("Invalid Golden Time state");
    if (state.finished) throw new Error("Cannot queue a next-day outcome after the final day");
    const lastSettledDay = state.dailyResults && state.dailyResults.length
      ? state.dailyResults[state.dailyResults.length - 1].day
      : 0;
    if (lastSettledDay !== state.day - 1) throw new Error("Queue night-news outcomes after settling the current day");
    const outcomeId = String(id || ("night-" + lastSettledDay + "-" + (state.pendingMorningOutcomes || []).length));
    const pending = state.pendingMorningOutcomes || [];
    if (pending.some(item => item.id === outcomeId)) throw new Error("This night-news outcome is already queued");
    return {
      ...state,
      pendingMorningOutcomes: [...pending, {
        id: outcomeId,
        originDay: lastSettledDay,
        applyDay: state.day,
        outcome: clone(outcome || {}),
        applied: false
      }]
    };
  }

  // Return structured queued data to the news/UI modules. The caller owns
  // headline, ticker, and screen generation; this module only exposes data.
  function getPendingMorningOutcomes(state) {
    if (!state || state.version !== VERSION) throw new TypeError("Invalid Golden Time state");
    return clone((state.pendingMorningOutcomes || [])
      .filter(item => !item.applied && item.applyDay <= state.day));
  }

  // Called by the main game flow after morning news is prepared/displayed.
  // Apply queued effects once before the new day's decisions begin.
  function applyMorningOutcomes(state, options) {
    if (!state || state.version !== VERSION) throw new TypeError("Invalid Golden Time state");
    if (state.finished) throw new Error("The game is already finished");
    if ((state.dailyResults || []).some(result => result.day === state.day)) {
      throw new Error("Morning outcomes must be applied before settling the current day");
    }
    const pending = state.pendingMorningOutcomes || [];
    const due = pending.filter(item => !item.applied && item.applyDay <= state.day);
    if (due.length === 0) return state;
    let next = state;
    for (const item of due) {
      next = applyOutcome(next, {
        ...item.outcome,
        source: item.outcome.source || "previous-night-news",
        details: { ...(item.outcome.details || {}), originDay: item.originDay, outcomeId: item.id }
      }, options);
    }
    const dueIds = new Set(due.map(item => item.id));
    return {
      ...next,
      pendingMorningOutcomes: pending.map(item => dueIds.has(item.id) ? { ...item, applied: true } : item)
    };
  }

  // Close the current day; pass its news/event outcome here when applicable.
  function closeDay(state, outcome, options) {
    let next = outcome ? applyOutcome(state, outcome, options) : state;
    const dailyResults = next.dailyResults || [];
    if (dailyResults.some(result => result.day === next.day)) throw new Error("This day has already been settled");
    const scoringOptions = { ...(next.rules || {}), ...options };
    const finalScore = calculateFinalScore(next, scoringOptions);
    const grade = getGrade(finalScore, scoringOptions);
    const dailyResult = {
      day: next.day,
      scores: clone(next.scores),
      scoredCategories: getScoredCategories(next),
      budget: next.budget,
      disaster: clone(next.disaster),
      finalScore,
      ...grade
    };
    const results = [...dailyResults, dailyResult];
    if (next.day >= next.days) return { ...next, dailyResults: results, finished: true };
    return { ...next, dailyResults: results, day: next.day + 1 };
  }

  function calculateFinalScore(state, options) {
    const config = configWith({ ...(state.rules || {}), ...options, days: state.days, startingBudget: state.initialBudget });
    const scoredCategories = getScoredCategories(state);
    if (scoredCategories.length === 0) return 0;
    const includedWeight = scoredCategories.reduce((sum, key) => sum + config.weights[key], 0);
    const weighted = scoredCategories.reduce((sum, key) => sum + state.scores[key] * config.weights[key], 0) / includedWeight;
    // Remaining budget is reported separately from the budget-performance score;
    // the outcome producer decides how budget usage affects that score.
    return Math.round(weighted * 100) / 100;
  }

  // Categories with no completed assessment are omitted from this settlement.
  function getScoredCategories(state) {
    const integrity = state.integrityStats || {};
    const economic = state.economicDefenseStats || {};
    const innovation = state.innovationStats || {};
    const budget = state.budgetStats || {};
    const assessed = {
      integrity: (integrity.correct || 0) + (integrity.ordinaryWrong || 0) + (integrity.falseApprovals || 0) > 0,
      economicDefense: (economic.events || 0) > 0,
      innovation: (innovation.decisions || 0) > 0,
      budgetPerformance: (budget.allocatedTotal || 0) > 0
    };
    return SCORE_KEYS.filter(key => assessed[key]);
  }

  function getGrade(score, options) {
    const config = configWith(options);
    const match = [...config.grades].sort((a, b) => b.min - a.min).find(item => score >= item.min);
    return match ? { grade: match.grade, title: match.title } : { grade: "D", title: "재도전 필요" };
  }

  function summarize(state, options) {
    const scoringOptions = { ...(state.rules || {}), ...options };
    const score = calculateFinalScore(state, scoringOptions);
    return {
      day: state.day,
      days: state.days,
      budget: state.budget,
      scores: clone(state.scores),
      scoredCategories: getScoredCategories(state),
      integrityStats: clone(state.integrityStats || { correct: 0, ordinaryWrong: 0, falseApprovals: 0 }),
      economicDefenseStats: clone(state.economicDefenseStats || { events: 0, totalScore: 0 }),
      innovationStats: clone(state.innovationStats || { decisions: 0, totalScore: 0 }),
      budgetStats: clone(state.budgetStats || { allocatedTotal: 0, weightedScoreTotal: 0 }),
      disaster: clone(state.disaster),
      dailyResults: clone(state.dailyResults || []),
      pendingMorningOutcomes: clone(state.pendingMorningOutcomes || []),
      finalScore: score,
      ...getGrade(score, scoringOptions),
      finished: state.finished
    };
  }

  // Final score is primary; shorter real play time breaks score ties.
  // Entries still tied on both fields share the same competition rank.
  function rank(entries) {
    const sorted = (entries || []).map((entry, index) => ({ ...entry, _index: index }))
      .sort((a, b) => {
        const scoreOrder = b.finalScore - a.finalScore;
        if (scoreOrder !== 0) return scoreOrder;
        const aTime = Number.isFinite(a.playTimeMs) ? a.playTimeMs : Infinity;
        const bTime = Number.isFinite(b.playTimeMs) ? b.playTimeMs : Infinity;
        return (aTime - bTime) || (a._index - b._index);
      });
    const ranked = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const entry = sorted[index];
      const previous = ranked[index - 1];
      const sameScore = previous && previous.finalScore === entry.finalScore;
      const sameTime = previous && previous.playTimeMs === entry.playTimeMs;
      const rankNumber = sameScore && sameTime ? previous.rank : index + 1;
      const { _index, ...cleanEntry } = entry;
      ranked.push({ ...cleanEntry, rank: rankNumber });
    }
    return ranked;
  }

  // Storage is injected so this module works in tests, browsers, and host games.
  function save(storage, key, state) {
    if (!storage || typeof storage.setItem !== "function") throw new TypeError("A storage adapter with setItem is required");
    storage.setItem(key || "golden-time-save", JSON.stringify({ version: VERSION, state }));
  }
  function load(storage, key) {
    if (!storage || typeof storage.getItem !== "function") throw new TypeError("A storage adapter with getItem is required");
    const raw = storage.getItem(key || "golden-time-save");
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (payload.version !== VERSION || !payload.state || payload.state.version !== VERSION) return null;
    return {
      playTimeMs: 0,
      rankingSubmitted: false,
      ...payload.state
    };
  }
  function addRankingEntry(storage, entry, key) {
    if (!entry || entry.completed !== true) throw new Error("Only completed game records can be ranked");
    if (!Number.isFinite(entry.finalScore)) throw new TypeError("finalScore must be a finite number");
    if (!Number.isFinite(entry.playTimeMs) || entry.playTimeMs < 0) throw new TypeError("playTimeMs must be a non-negative number");
    const storageKey = key || "golden-time-ranking";
    const current = storage.getItem(storageKey);
    const entries = current ? JSON.parse(current) : [];
    const ranked = rank([...entries, entry]).slice(0, 10);
    storage.setItem(storageKey, JSON.stringify(ranked));
    return ranked;
  }

  // Convenience wrapper for the browser game: persist every state-changing
  // operation, resume saved state, and track only active play time.
  function createSession(storage, options) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new TypeError("A storage adapter with getItem and setItem is required");
    }
    const settings = options || {};
    const saveKey = settings.saveKey || "golden-time-save";
    const rankingKey = settings.rankingKey || "golden-time-ranking";
    let state = load(storage, saveKey) || createState(settings.stateOptions);
    let activeSince = null;

    function checkpoint() {
      if (activeSince !== null) {
        const now = Date.now();
        state = { ...state, playTimeMs: (state.playTimeMs || 0) + Math.max(0, now - activeSince) };
        activeSince = now;
      }
      save(storage, saveKey, state);
      return clone(state);
    }

    const update = method => (...args) => {
      state = method(state, ...args);
      checkpoint();
      return clone(state);
    };

    return Object.freeze({
      getState: () => clone(state),
      start: () => {
        if (state.finished) throw new Error("The game is already finished");
        if (activeSince === null) activeSince = Date.now();
        checkpoint();
        return clone(state);
      },
      pause: () => {
        checkpoint();
        activeSince = null;
        save(storage, saveKey, state);
        return clone(state);
      },
      bindPageLifecycle: target => {
        if (!target || typeof target.addEventListener !== "function") {
          throw new TypeError("A page lifecycle target with addEventListener is required");
        }
        const onPageHide = () => { checkpoint(); activeSince = null; save(storage, saveKey, state); };
        const onPageShow = event => { if (event && event.persisted && !state.finished) activeSince = Date.now(); };
        target.addEventListener("pagehide", onPageHide);
        target.addEventListener("pageshow", onPageShow);
        return () => {
          target.removeEventListener("pagehide", onPageHide);
          target.removeEventListener("pageshow", onPageShow);
        };
      },
      saveNow: checkpoint,
      getPlayTimeMs: () => (state.playTimeMs || 0) + (activeSince === null ? 0 : Math.max(0, Date.now() - activeSince)),
      getPendingMorningOutcomes: () => getPendingMorningOutcomes(state),
      beginDisaster: update(beginDisaster),
      applyOutcome: update(applyOutcome),
      queueMorningOutcome: update(queueMorningOutcome),
      applyMorningOutcomes: update(applyMorningOutcomes),
      closeDay: update(closeDay),
      finalizeRanking: playerName => {
        if (!state.finished) throw new Error("Complete all game days before saving a ranking record");
        checkpoint();
        activeSince = null;
        if (state.rankingSubmitted) {
          const saved = storage.getItem(rankingKey);
          return saved ? JSON.parse(saved) : [];
        }
        const finalResult = state.dailyResults[state.dailyResults.length - 1];
        const ranked = addRankingEntry(storage, {
          name: String(playerName || "플레이어"),
          completed: true,
          finalScore: finalResult.finalScore,
          grade: finalResult.grade,
          playTimeMs: state.playTimeMs
        }, rankingKey);
        state = { ...state, rankingSubmitted: true };
        save(storage, saveKey, state);
        return ranked;
      }
    });
  }

  return Object.freeze({ VERSION, DEFAULTS, createState, createSession, beginDisaster, applyOutcome, queueMorningOutcome, getPendingMorningOutcomes, applyMorningOutcomes, closeDay, calculateIntegrityScore, calculateEconomicComponents, calculateReplenishmentPlan, calculateExpectedPlanCost, classifyMarketResponse, calculateEconomicDefenseScore, calculateInnovationScore, calculateBudgetPerformanceScore, calculateDisasterProgress, calculateFinalScore, getScoredCategories, getGrade, summarize, rank, save, load, addRankingEntry });
});
