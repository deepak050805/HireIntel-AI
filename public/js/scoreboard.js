// ===== SCOREBOARD LOGIC =====
function buildScoreboard() {
  const atsScore = state.atsData?.overallScore || 0;
  const interviewType = state.selectedInterviewType || "hr";
  const evaluations = interviewType === "technical" ? state.techEvaluations : state.hrEvaluations;
  const interviewAvg = calculateAvg(evaluations);
  const semanticScore = Math.round(state.semanticData?.matchScore || state.semanticData?.semantic || 0);
  const communicationScore = estimateCommunicationScore(evaluations, interviewType);
  const technicalScore = interviewType === "technical"
    ? (averageDimension(evaluations, "technicalDepth") || averageDimension(evaluations, "problemSolving") || interviewAvg)
    : Math.round((semanticScore * 0.55) + (atsScore * 0.45));
  const confidenceScore = estimateConfidenceScore(evaluations, semanticScore);

  const finalScore = Math.round((atsScore * 0.25) + (semanticScore * 0.20) + (interviewAvg * 0.35) + (confidenceScore * 0.20));

  animateNumber(document.getElementById("finalScoreNum"), finalScore);
  animateGauge(document.getElementById("finalGaugeFg"), finalScore);

  document.getElementById("scoreBreakdown").innerHTML = `
    <div class="breakdown-card">
      <div class="score">${communicationScore}</div>
      <div class="label">Communication</div>
      <div class="weight">Clarity and structure</div>
    </div>
    <div class="breakdown-card">
      <div class="score">${technicalScore}</div>
      <div class="label">${interviewType === "technical" ? "Technical" : "Role"} Signal</div>
      <div class="weight">Depth and relevance</div>
    </div>
    <div class="breakdown-card">
      <div class="score">${confidenceScore}</div>
      <div class="label">Confidence</div>
      <div class="weight">Consistency of answers</div>
    </div>
  `;

  renderMiniRadar(atsScore, semanticScore, interviewAvg, communicationScore, confidenceScore);
  renderInterviewSummary({
    finalScore,
    atsScore,
    semanticScore,
    interviewAvg,
    interviewType,
    communicationScore,
    technicalScore,
    confidenceScore,
    evaluations
  });
}

function calculateAvg(evals) {
  if (!evals || evals.length === 0) return 0;
  const sum = evals.reduce((a, b) => a + (Number(b.score) || 0), 0);
  return Math.round((sum / (evals.length * 10)) * 100);
}

function estimateCommunicationScore(evals, interviewType) {
  if (!evals || !evals.length) return interviewType === "hr" ? 58 : 54;
  const dimensionAvg = averageDimension(evals, "communication");
  if (dimensionAvg) return dimensionAvg;
  const avg = calculateAvg(evals);
  const feedbackText = evals.map((item) => item.feedback || "").join(" ").toLowerCase();
  const bonus = ["clear", "specific", "structured", "strong"].some((word) => feedbackText.includes(word)) ? 6 : 0;
  return clampScore(avg + bonus);
}

function estimateConfidenceScore(evals, semanticScore) {
  if (!evals || !evals.length) return clampScore(Math.round(semanticScore * 0.7));
  const dimensionAvg = averageDimension(evals, "confidence");
  if (dimensionAvg) return dimensionAvg;
  const scores = evals.map((item) => Number(item.score) || 0);
  const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + Math.abs(score - avg), 0) / scores.length;
  return clampScore(Math.round((avg * 10) - (variance * 7)));
}

function averageDimension(evals, key) {
  const values = (evals || [])
    .map((item) => item.dimensionScores && Number(item.dimensionScores[key]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getFinalLabel(score) {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Strong";
  if (score >= 50) return "Promising";
  return "Developing";
}

function renderMiniRadar(ats, semantic, interview, communication, confidence) {
  const container = document.getElementById("radarChart");
  const values = [
    ["ATS", ats],
    ["Semantic", semantic],
    ["Interview", interview],
    ["Clarity", communication],
    ["Confidence", confidence]
  ];

  container.innerHTML = values.map(([label, value]) => `
    <div class="radar-bar">
      <span style="height:${Math.max(8, value)}%"></span>
      <span>${label}</span>
    </div>
  `).join("");
}

function renderInterviewSummary(data) {
  const strengths = buildStrengths(data);
  const improvements = buildImprovements(data);
  const weakAreas = buildWeakAreas(data);
  const roadmap = buildRoadmap(data);

  document.getElementById("scoreSummary").innerHTML = `
    <div class="summary-header">
      <div>
        <span class="summary-kicker">${data.interviewType === "technical" ? "Technical" : "HR"} interview report</span>
        <strong>${getFinalLabel(data.finalScore)} candidate readiness</strong>
      </div>
      <span class="summary-pill">${data.finalScore}/100</span>
    </div>
    <div class="insight-columns">
      <section>
        <h3>Strengths</h3>
        <ul>${strengths.map((item) => `<li>${item}</li>`).join("")}</ul>
      </section>
      <section>
        <h3>Improve next</h3>
        <ul>${improvements.map((item) => `<li>${item}</li>`).join("")}</ul>
      </section>
      <section>
        <h3>Watch areas</h3>
        <ul>${weakAreas.map((item) => `<li>${item}</li>`).join("")}</ul>
      </section>
    </div>
    <div class="verdict-section">
      <h3>Recruiter's Final Verdict</h3>
      <div class="verdict-card">
        <div class="verdict-badge">${getVerdictLabel(data)}</div>
        <p>${generateVerdictText(data)}</p>
      </div>
    </div>
    <div class="roadmap-section">
      <h3>Strategic Improvement Roadmap</h3>
      <div class="roadmap-grid">
        ${roadmap.map((step) => `
          <div class="roadmap-step">
            <span class="step-tag">${step.tag}</span>
            <p>${step.desc}</p>
          </div>
        `).join("")}
      </div>
    </div>
    <p class="final-note"><strong>Executive Summary:</strong> Candidate exhibits ${getTone(data)} communication with ${data.technicalScore >= 70 ? 'strong' : 'developing'} technical reasoning. Recommended trajectory: ${data.finalScore >= 75 ? 'Direct advancement' : 'Focused skill-gap closure'}.</p>
  `;
}

function buildStrengths(data) {
  const strengths = [];
  if (data.semanticScore >= 65) strengths.push("Resume context aligns well with the target role.");
  if (data.communicationScore >= 70) strengths.push("Answers showed clear communication and interview composure.");
  if (data.technicalScore >= 70) strengths.push("Role-specific signal is strong enough for deeper evaluation.");
  if (!strengths.length) strengths.push("Candidate has enough baseline signal to continue with structured coaching.");
  return strengths.slice(0, 3);
}

function buildImprovements(data) {
  const items = [];
  if (data.communicationScore < 75) items.push("Use a clearer situation-action-result structure in answers.");
  if (data.confidenceScore < 75) items.push("Add more specific outcomes, metrics, and decision rationale.");
  if (data.interviewType === "technical" && data.technicalScore < 75) items.push("Go deeper on architecture trade-offs, debugging steps, and validation.");
  if (data.interviewType === "hr" && data.interviewAvg < 75) items.push("Connect motivation and ownership examples more directly to the role.");
  return items.slice(0, 3);
}

function buildWeakAreas(data) {
  const areas = [];
  if (data.atsScore < 60) areas.push("Resume structure may undersell interview readiness.");
  if (data.semanticScore < 55) areas.push("Role alignment needs sharper evidence.");
  if (data.confidenceScore < 65) areas.push("Answer consistency should be strengthened before final rounds.");
  if (!areas.length) areas.push("No major weak area detected from this interview pass.");
  return areas.slice(0, 3);
}

function buildRoadmap(data) {
  const steps = [];
  if (data.technicalScore < 80) {
    steps.push({ tag: "Technical", desc: "Deepen understanding of architecture trade-offs and performance bottlenecks." });
  }
  if (data.communicationScore < 80) {
    steps.push({ tag: "Communication", desc: "Practice structured storytelling (STAR) to better highlight personal impact." });
  }
  if (data.confidenceScore < 80) {
    steps.push({ tag: "Confidence", desc: "Focus on quantified achievements and specific data-driven outcomes." });
  }
  if (steps.length < 2) {
    steps.push({ tag: "Next Steps", desc: "Prepare for high-level system design and cultural alignment discussions." });
  }
  return steps;
}

function getVerdictLabel(data) {
  if (data.finalScore >= 85) return "Highly Recommended";
  if (data.finalScore >= 75) return "Recommended";
  if (data.finalScore >= 60) return "Qualified";
  return "Review Needed";
}

function generateVerdictText(data) {
  if (data.finalScore >= 85) return "An exceptional candidate with balanced technical depth and clear, consistent communication. Exhibits strong ownership and is ready for high-impact responsibilities.";
  if (data.finalScore >= 75) return "A strong candidate demonstrating solid understanding of core concepts. With minor refinement in specific trade-off analysis, they will be a significant asset to the team.";
  if (data.finalScore >= 60) return "A capable professional who meets the base requirements. Further validation of specialized technical depth or leadership scenarios is recommended for seniority alignment.";
  return "Candidate demonstrates potential but requires additional mentorship or fundamental upskilling in key technical areas before role deployment.";
}

function getTone(data) {
  if (data.communicationScore >= 85) return "articulate and persuasive";
  if (data.communicationScore >= 70) return "clear and professional";
  return "direct and functional";
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value || 0)));
}
