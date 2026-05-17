// ===== GLOBAL STATE =====
const state = {
  resumeText: "",
  resumeFile: null,
  atsData: null,
  jobsData: null,
  gapsData: null,
  hrQuestions: null,
  hrEvaluations: [],
  hrCurrentQ: 0,
  techQuestions: null,
  techEvaluations: [],
  techCurrentQ: 0,
  currentSection: 0,
  followUpCount: 0,
  semanticData: null,
  selectedInterviewType: null,
};

// ===== NAVIGATION =====
function goToSection(index) {
  // Gracefully stop any active audio playback or speech recognition
  if (window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      console.error(e);
    }
  }
  if (typeof SpeechToText !== "undefined") {
    try {
      SpeechToText.stop();
    } catch (e) {
      console.error(e);
    }
  }

  state.currentSection = index;
  const sections = document.querySelectorAll(".section");
  sections.forEach((s) => s.classList.remove("active"));

  const sectionIds = [
    "section-upload",
    "section-analysis",
    "section-interview-select",
    "section-hr",
    "section-tech",
    "section-scoreboard"
  ];
  const target = document.getElementById(sectionIds[index]);
  if (target) target.classList.add("active");

  // Update nav steps
  const steps = document.querySelectorAll(".nav-step");
  const connectors = document.querySelectorAll(".nav-connector");
  const navIndex = index <= 1 ? index : index <= 4 ? 2 : 3;

  steps.forEach((s, i) => {
    s.classList.remove("active", "completed");
    if (i === navIndex) s.classList.add("active");
    else if (i < navIndex) s.classList.add("completed");
  });

  connectors.forEach((c, i) => {
    c.classList.remove("completed");
    if (i < navIndex) c.classList.add("completed");
  });

  window.scrollTo({ top: 0, behavior: "smooth" });

  // Trigger section-specific init
  if (index === 3) initInterview("hr");
  if (index === 4) initInterview("technical");
  if (index === 5) buildScoreboard();
}

function selectInterview(type) {
  state.selectedInterviewType = type;
  state.followUpCount = 0;
  if (type === "hr") goToSection(3);
  else goToSection(4);
}

// ===== LOADING OVERLAY =====
function showLoading(text) {
  document.getElementById("loadingText").textContent = text || "Processing...";
  document.getElementById("loadingOverlay").classList.add("active");
}

function hideLoading() {
  document.getElementById("loadingOverlay").classList.remove("active");
}

// ===== API HELPER =====
async function apiCall(url, data, timeout = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: controller.signal
    });
    clearTimeout(id);
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(json.error || `Server error: ${res.status}`);
    }
    return json;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      throw new Error("Request timed out. Please check your connection.");
    }
    throw err;
  }
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled rejection:', event.reason);
  // hideLoading(); // Safely clear loading if something crashes
});

// ===== UTILITY =====
function getScoreColor(score) {
  if (score >= 80) return "#09090b";
  if (score >= 60) return "#3f3f46";
  if (score >= 40) return "#71717a";
  return "#a1a1aa";
}

function animateNumber(el, target, duration = 1500) {
  let start = 0;
  const step = target / (duration / 16);
  const timer = setInterval(() => {
    start += step;
    if (start >= target) {
      start = target;
      clearInterval(timer);
    }
    el.textContent = Math.round(start);
  }, 16);
}

function animateGauge(circleEl, score, maxScore = 100) {
  const r = parseFloat(circleEl.getAttribute("r"));
  const circumference = 2 * Math.PI * r;
  circleEl.style.strokeDasharray = circumference;
  circleEl.style.strokeDashoffset = circumference;
  circleEl.style.stroke = getScoreColor(score);

  setTimeout(() => {
    const offset = circumference - (score / maxScore) * circumference;
    circleEl.style.strokeDashoffset = offset;
  }, 100);
}
