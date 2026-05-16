// ===== FILE UPLOAD =====
const uploadZone = document.getElementById("uploadZone");
const fileInput = document.getElementById("fileInput");
const fileInfo = document.getElementById("fileInfo");
const analyzeBtn = document.getElementById("analyzeBtn");

uploadZone.addEventListener("click", () => fileInput.click());
uploadZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("dragover");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("dragover");
});

uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  const validTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
  ];

  if (!validTypes.includes(file.type)) {
    alert("Please upload a PDF or DOCX file.");
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    alert("File too large. Maximum size is 10MB.");
    return;
  }

  state.resumeFile = file;
  document.getElementById("fileName").textContent = file.name;
  document.getElementById("fileSize").textContent = (file.size / 1024).toFixed(1) + " KB";
  fileInfo.classList.remove("hidden");
  analyzeBtn.classList.remove("hidden");
}

async function startAnalysis() {
  if (!state.resumeFile) return;

  const progressBar = document.getElementById("uploadProgress");
  const progressFill = document.getElementById("uploadFill");
  progressBar.classList.remove("hidden");
  analyzeBtn.disabled = true;

  showLoading("Uploading and parsing your resume...");
  progressFill.style.width = "30%";

  try {
    const formData = new FormData();
    formData.append("resume", state.resumeFile);

    const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
    const uploadData = await uploadRes.json();

    if (!uploadRes.ok || uploadData.error) throw new Error(uploadData.error);

    state.resumeText = uploadData.resumeText;
    progressFill.style.width = "50%";

    showLoading("Analyzing ATS compatibility...");
    const atsRes = await apiCall("/api/analyze/ats", { resumeText: state.resumeText });
    state.atsData = atsRes.data;
    progressFill.style.width = "70%";

    showLoading("Finding best-fit role signals...");
    const jobsRes = await apiCall("/api/analyze/jobs", { resumeText: state.resumeText });
    state.jobsData = jobsRes.data;
    progressFill.style.width = "84%";

    showLoading("Identifying resume gaps...");
    const gapsRes = await apiCall("/api/analyze/gaps", { resumeText: state.resumeText });
    state.gapsData = gapsRes.data;
    progressFill.style.width = "92%";

    showLoading("Building semantic match insights...");
    await runSemanticMatch(true);
    progressFill.style.width = "100%";

    hideLoading();

    renderATSResults();
    renderJobResults();
    renderGapResults();
    renderFeedbackResults();
    goToSection(1);
  } catch (err) {
    hideLoading();
    alert("Error: " + err.message);
    analyzeBtn.disabled = false;
    progressBar.classList.add("hidden");
  }
}
