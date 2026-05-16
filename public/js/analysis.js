// ===== ANALYSIS DISPLAY =====
function renderATSResults() {
  const data = state.atsData;
  const scoreNum = document.getElementById("atsScoreNum");
  const gaugeFg = document.getElementById("atsGaugeFg");
  const summary = document.getElementById("atsSummary");
  const categoriesGrid = document.getElementById("atsCategories");

  animateNumber(scoreNum, data.overallScore);
  animateGauge(gaugeFg, data.overallScore);
  summary.textContent = data.summary;

  categoriesGrid.innerHTML = "";
  for (const [key, cat] of Object.entries(data.categories || {})) {
    const card = document.createElement("div");
    card.className = "category-card";
    card.innerHTML = `
      <div class="category-score">✓</div>
      <div>
        <div style="font-weight:700;text-transform:capitalize;margin-bottom:8px">${formatLabel(key)}</div>
        <div class="category-bar"><div class="fill" style="width:${cat.score || 0}%"></div></div>
        <div style="font-size:0.82rem;color:var(--muted);margin-top:8px">${cat.feedback || "No issues detected."}</div>
      </div>
    `;
    categoriesGrid.appendChild(card);
  }
}

function renderJobResults() {
  const container = document.getElementById("jobCards");
  const roles = (state.jobsData && state.jobsData.topRoles) || [];
  container.innerHTML = "";

  roles.slice(0, 3).forEach((job) => {
    const card = document.createElement("div");
    card.className = "job-card";
    card.innerHTML = `
      <div class="match">Strong Alignment</div>
      <div class="title">${job.title}</div>
      <div style="color:var(--muted);font-size:.86rem;margin-bottom:8px">${job.industry || "Suggested role"}</div>
      <p style="font-size:.9rem;color:#52525b;line-height:1.6">${job.reasoning || ""}</p>
    `;
    container.appendChild(card);
  });

  const firstRole = roles[0];
  const jobInput = document.getElementById("jobDescriptionInput");
  if (firstRole && !jobInput.value) {
    jobInput.value = `${firstRole.title}. ${firstRole.reasoning || ""}`;
  }
}

function renderGapResults() {
  const container = document.getElementById("gapsList");
  const assessment = document.getElementById("gapAssessment");
  const gaps = (state.gapsData && state.gapsData.missingSections) || [];

  assessment.textContent = state.gapsData?.overallAssessment || "No major gaps identified.";
  container.innerHTML = "";

  if (!gaps.length) {
    container.innerHTML = `<div class="gap-item">No critical missing sections were detected.</div>`;
    return;
  }

  gaps.slice(0, 4).forEach((gap) => {
    const item = document.createElement("div");
    item.className = "gap-item";
    item.innerHTML = `
      <strong style="text-transform:capitalize">${gap.section}</strong>
      <div class="priority ${gap.importance}">${gap.importance} priority</div>
    `;
    container.appendChild(item);
  });
}

async function runSemanticMatch(silent = false) {
  if (!state.resumeText) return;
  const input = document.getElementById("jobDescriptionInput");
  const fallbackRole = state.jobsData?.topRoles?.[0];
  const jobDescription = input?.value?.trim() || fallbackRole?.title || "target role";

  if (!silent) showLoading("Updating semantic match...");
  try {
    const res = await apiCall("/api/semantic_match", {
      resumeText: state.resumeText,
      jobDescription
    });
    state.semanticData = res.data;
    renderSemanticResults();
  } catch (err) {
    if (!silent) alert("Semantic match failed: " + err.message);
  } finally {
    if (!silent) hideLoading();
  }
}

function renderSemanticResults() {
  const data = state.semanticData || {};
  const semantic = Math.round(data.semantic || data.matchScore || 0);
  // document.getElementById("semanticScore").textContent = semantic; // Removed from HTML
  document.getElementById("semanticLabel").textContent = getSemanticLabel(semantic);
  document.getElementById("semanticExplain").textContent = 
    "AI-detected alignment based on candidate background and target role requirements.";
}

function renderFeedbackResults() {
  const container = document.getElementById("feedbackList");
  const suggestions = buildResumeSuggestions();
  container.innerHTML = suggestions.map((item) => `
    <div class="feedback-item">
      <strong>${item.title}</strong>
      <div>${item.copy}</div>
    </div>
  `).join("");
}

function buildResumeSuggestions() {
  const ats = state.atsData || {};
  const categories = ats.categories || {};
  const suggestions = [];

  Object.entries(categories).forEach(([key, value]) => {
    if ((value.score || 0) < 75) {
      suggestions.push({
        title: `Improve ${formatLabel(key)}`,
        copy: value.feedback || "Add clearer evidence, measurable outcomes, and role-specific keywords."
      });
    }
  });

  const gaps = state.gapsData?.missingSections || [];
  gaps.slice(0, 2).forEach((gap) => {
    suggestions.push({
      title: `Add ${formatLabel(gap.section)}`,
      copy: "This section can improve parseability and make recruiter review faster."
    });
  });

  if (!suggestions.length) {
    suggestions.push({
      title: "Strong foundation",
      copy: "The resume is well structured. Consider tailoring the summary and top skills to the target role for a sharper semantic match."
    });
  }

  return suggestions.slice(0, 4);
}

function getSemanticLabel(score) {
  if (score >= 75) return "Strong semantic alignment";
  if (score >= 55) return "Promising match";
  if (score >= 35) return "Partial alignment";
  return "Needs stronger role alignment";
}

function formatLabel(value) {
  return String(value || "")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
