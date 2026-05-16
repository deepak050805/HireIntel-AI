// ===== INTERVIEW LOGIC =====
const interviewRuntime = {
  activeType: null,
  isSubmitting: false,
  typingTimers: [],
  history: {
    hr: [],
    technical: []
  },
  voiceMode: false,
  isRecording: false,
  recognition: null,
};

async function initInterview(type) {
  const normalizedType = type === "hr" ? "hr" : "technical";
  const uiType = normalizedType === "hr" ? "hr" : "tech";
  const container = document.getElementById(`${uiType}Messages`);
  const input = document.getElementById(`${uiType}Input`);
  const button = input?.closest(".chat-input-area")?.querySelector("button");

  interviewRuntime.activeType = normalizedType;
  interviewRuntime.isSubmitting = false;
  interviewRuntime.history[normalizedType] = [];
  clearInterviewTimers();
  container.innerHTML = "";
  setInterviewInputState(normalizedType, true, "Preparing...");
  updateProgress(normalizedType, 0, 0);
  updateModeContext(normalizedType, "Reading resume and role context.");

  showLoading(`Preparing your ${normalizedType.toUpperCase()} interview session...`);

  try {
    const res = await apiCall("/api/interview/start", {
      resumeText: state.resumeText,
      type: normalizedType,
      context: buildInterviewContext()
    });

    const questions = normalizeQuestions(res.data.questions);
    if (!questions.length) throw new Error("No interview questions returned");

    if (normalizedType === "hr") {
      state.hrQuestions = questions;
      state.hrCurrentQ = 0;
      state.hrEvaluations = [];
    } else {
      state.techQuestions = questions;
      state.techCurrentQ = 0;
      state.techEvaluations = [];
    }

    updateModeContext(normalizedType, buildModeContextCopy(normalizedType, res.data.session));
    hideLoading();
    setInterviewInputState(normalizedType, false);

    await addTimedAIMessage(normalizedType, res.data.openingMessage, { tone: "opening" });
    askQuestion(normalizedType);
    input?.focus();
  } catch (err) {
    hideLoading();
    setInterviewInputState(normalizedType, false);
    addRetryMessage(normalizedType);
    console.error("Interview start failed", err);
  }

  if (button) button.textContent = "Send";
  initVoiceSystem();
}

function initVoiceSystem() {
  const hrToggle = document.getElementById("hrVoiceToggle");
  const techToggle = document.getElementById("techVoiceToggle");
  const hrMic = document.getElementById("hrMicBtn");
  const techMic = document.getElementById("techMicBtn");

  [hrToggle, techToggle].forEach(btn => {
    btn?.addEventListener("click", () => {
      interviewRuntime.voiceMode = !interviewRuntime.voiceMode;
      hrToggle?.classList.toggle("active", interviewRuntime.voiceMode);
      techToggle?.classList.toggle("active", interviewRuntime.voiceMode);
      if (interviewRuntime.voiceMode) {
        speakAI("Voice mode activated. I will read the questions and feedback aloud.");
      } else {
        window.speechSynthesis.cancel();
      }
    });
  });

  [hrMic, techMic].forEach(btn => {
    btn?.addEventListener("click", () => toggleMicrophone(interviewRuntime.activeType));
  });

  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    interviewRuntime.recognition = new SpeechRecognition();
    interviewRuntime.recognition.continuous = false;
    interviewRuntime.recognition.interimResults = false;
    interviewRuntime.recognition.lang = 'en-US';

    interviewRuntime.recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      const input = getInterviewInput(interviewRuntime.activeType);
      if (input) {
        input.value = text;
        autoResizeTextarea(input);
        submitAnswer(interviewRuntime.activeType);
      }
    };

    interviewRuntime.recognition.onend = () => {
      interviewRuntime.isRecording = false;
      hrMic?.classList.remove("recording");
      techMic?.classList.remove("recording");
    };

    interviewRuntime.recognition.onerror = (err) => {
      console.error("Speech recognition error", err);
      interviewRuntime.isRecording = false;
      hrMic?.classList.remove("recording");
      techMic?.classList.remove("recording");
    };
  }
}

function toggleMicrophone(type) {
  if (!interviewRuntime.recognition) {
    alert("Speech recognition is not supported in this browser.");
    return;
  }

  if (interviewRuntime.isRecording) {
    interviewRuntime.recognition.stop();
  } else {
    interviewRuntime.isRecording = true;
    const btn = document.getElementById(`${type === "hr" ? "hr" : "tech"}MicBtn`);
    btn?.classList.add("recording");
    interviewRuntime.recognition.start();
  }
}

function speakAI(text) {
  if (!interviewRuntime.voiceMode) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Try to find a professional-sounding voice
  const voices = window.speechSynthesis.getVoices();
  const preferredVoice = voices.find(v => v.name.includes("Google US English") || v.name.includes("Male") || v.name.includes("Natural"));
  if (preferredVoice) utterance.voice = preferredVoice;
  
  utterance.pitch = 1.0;
  utterance.rate = 0.95; // Slightly slower for a professional, calm feel
  window.speechSynthesis.speak(utterance);
}

function buildInterviewContext() {
  return {
    atsScore: state.atsData && state.atsData.overallScore,
    semanticScore: state.semanticData && (state.semanticData.matchScore || state.semanticData.semantic),
    roleContext: document.getElementById("jobDescriptionInput")?.value || "",
    topRoles: state.jobsData && state.jobsData.topRoles,
    gaps: state.gapsData && state.gapsData.missingSections
  };
}

function normalizeQuestions(questions) {
  return (questions || [])
    .filter((q) => q && q.question)
    .map((q, index) => ({
      id: q.id || index + 1,
      question: q.question,
      difficulty: q.difficulty || "medium",
      focus: q.focus || "role alignment"
    }));
}

function buildModeContextCopy(type, session) {
  const skills = (session?.skills || []).slice(0, 3).join(", ");
  if (type === "technical") {
    return skills
      ? `Problem-solving focus: ${skills}. Expect practical depth and trade-off questions.`
      : "Problem-solving focus with practical technical follow-ups.";
  }
  return skills
    ? `Conversation focus: motivation, ownership, communication, and ${skills}.`
    : "Conversation focus: motivation, ownership, communication, and role fit.";
}

function updateModeContext(type, text) {
  const el = document.getElementById(`${type === "hr" ? "hr" : "tech"}ModeNote`);
  if (el) el.textContent = text;
}

function askQuestion(type) {
  const qList = getQuestionList(type);
  const currentIdx = getCurrentIndex(type);

  if (currentIdx < qList.length) {
    const q = qList[currentIdx];
    updateProgress(type, currentIdx + 1, qList.length);
    setInterviewInputState(type, true, "Listening...");
    addTimedAIMessage(type, q.question, {
      tone: "question",
      eyebrow: `Question ${currentIdx + 1} of ${qList.length}`,
      meta: `${capitalize(q.difficulty)} difficulty / ${q.focus}`
    }).then(() => {
      setInterviewInputState(type, false);
      focusInterviewInput(type);
    });
  } else {
    completeInterview(type);
  }
}

async function submitAnswer(type) {
  const normalizedType = type === "hr" ? "hr" : "technical";
  const input = getInterviewInput(normalizedType);
  const answer = input.value.trim();
  if (!answer || interviewRuntime.isSubmitting) return;

  const qList = getQuestionList(normalizedType);
  const currentIdx = getCurrentIndex(normalizedType);
  const question = qList[currentIdx]?.question;
  if (!question) return;

  interviewRuntime.isSubmitting = true;
  addMessage("user", answer, normalizedType);
  input.value = "";
  autoResizeTextarea(input);
  setInterviewInputState(normalizedType, true, "Scoring...");
  showTyping(normalizedType, "Reviewing answer");

  try {
    const res = await apiCall("/api/interview/evaluate", {
      question,
      answer,
      type: normalizedType,
      resumeText: state.resumeText,
      context: buildInterviewContext(),
      history: interviewRuntime.history[normalizedType]
    });
    removeTyping(normalizedType);

    const feedback = normalizeFeedback(res.data);
    if (res.data.acknowledgment) {
      addMessage("ai", res.data.acknowledgment, normalizedType, { tone: "opening" });
    }
    addMessage("feedback", feedback.copy, normalizedType, {
      label: feedback.label
    });

    const followUpQuestion = getAllowedFollowUp(normalizedType, res.data.followUpQuestion);
    saveEvaluation(normalizedType, res.data, question, answer);
    maybeAdaptNextQuestion(normalizedType, res.data.suggestedNextQuestion);

    if (!followUpQuestion) incrementCurrentIndex(normalizedType);
    else state.followUpCount++;

    const delay = followUpQuestion ? 800 : 1200;
    window.setTimeout(() => {
      interviewRuntime.isSubmitting = false;
      setInterviewInputState(normalizedType, false);
      if (followUpQuestion) {
        addTimedAIMessage(normalizedType, followUpQuestion, {
          tone: "question",
          eyebrow: "Follow-up",
          meta: "Adaptive probe"
        }).then(() => focusInterviewInput(normalizedType));
      } else {
        askQuestion(normalizedType);
      }
    }, delay);
  } catch (err) {
    removeTyping(normalizedType);
    addMessage("feedback", "I could not score that answer right now. Your response is still here in the session; please try again.", normalizedType, {
      label: "Retry available"
    });
    console.error("Interview evaluation failed", err);
    interviewRuntime.isSubmitting = false;
    setInterviewInputState(normalizedType, false);
  }
}

function completeInterview(type) {
  updateProgress(type, getQuestionList(type).length, getQuestionList(type).length);
  setInterviewInputState(type, true, "Complete");
  addTimedAIMessage(type, "That completes the interview. I am preparing your performance summary now.", {
    tone: "completion"
  }).then(() => {
    window.setTimeout(() => goToSection(5), 900);
  });
}

function addMessage(sender, text, type, options = {}) {
  const container = getMessageContainer(type);
  const msg = document.createElement("div");
  msg.className = `message ${sender}${options.tone ? ` ${options.tone}` : ""}`;

  if (sender === "ai" && options.eyebrow) {
    const eyebrow = document.createElement("div");
    eyebrow.className = "message-eyebrow";
    eyebrow.textContent = options.eyebrow;
    msg.appendChild(eyebrow);
  }

  const body = document.createElement("div");
  body.textContent = text;
  msg.appendChild(body);

  if (options.meta || options.label) {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = [options.label, options.meta]
      .filter(Boolean)
      .join(" / ");
    msg.appendChild(meta);
  }

  container.appendChild(msg);
  scrollMessages(type);
  if (sender === "ai") speakAI(text);
  return msg;
}

function addTimedAIMessage(type, text, options = {}) {
  const label = options.tone === "question" ? "Interviewer is thinking" : "Interviewer is typing";
  showTyping(type, label);
  
  // Dynamic delay based on text length to simulate human typing/thinking
  const baseDelay = options.tone === "question" ? 1500 : 1000;
  const charsPerSecond = 50;
  const textDelay = (text.length / charsPerSecond) * 1000;
  const totalDelay = Math.min(4000, baseDelay + (textDelay * 0.4));

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      removeTyping(type);
      addMessage("ai", text, type, options);
      resolve();
    }, totalDelay);
    interviewRuntime.typingTimers.push(timer);
  });
}

function showTyping(type, label) {
  removeTyping(type);
  const container = getMessageContainer(type);
  const typing = document.createElement("div");
  typing.className = "typing-indicator";
  typing.dataset.typing = type;
  typing.innerHTML = `
    <span>${escapeText(label)}</span>
    <i></i><i></i><i></i>
  `;
  container.appendChild(typing);
  scrollMessages(type);
}

function removeTyping(type) {
  const container = getMessageContainer(type);
  container.querySelectorAll(`[data-typing="${type === "hr" ? "hr" : "technical"}"], [data-typing="${type === "technical" ? "technical" : "hr"}"]`).forEach((el) => el.remove());
}

function addRetryMessage(type) {
  const container = getMessageContainer(type);
  const card = document.createElement("div");
  card.className = "message feedback retry-card";
  card.innerHTML = `
    <div class="message-eyebrow">Interview could not start</div>
    <div>The interview session did not initialize cleanly. You can retry without leaving this screen.</div>
    <button type="button" class="secondary-cta retry-inline">Retry interview</button>
  `;
  card.querySelector("button").addEventListener("click", () => initInterview(type));
  container.appendChild(card);
  scrollMessages(type);
}

function normalizeFeedback(data) {
  const score = data?.score || 7;
  let copy = data?.feedback || "Useful answer. Add a more specific example and measurable result to strengthen it.";
  copy = copy.replace(/\s*\(Score:\s*\d+\/10\)\s*$/i, "").trim();
  const label = data?.signals?.answerQuality
    ? `${capitalize(data.signals.answerQuality)} answer`
    : score >= 8 ? "Strong answer" : score >= 6 ? "Developing answer" : "Needs more evidence";
  return { score, copy, label };
}

function getAllowedFollowUp(type, followUpQuestion) {
  if (!followUpQuestion) return "";
  if (state.followUpCount >= 1) {
    state.followUpCount = 0;
    return "";
  }
  return followUpQuestion;
}

function saveEvaluation(type, data, question, answer) {
  const entry = { ...data, question, answer };
  interviewRuntime.history[type].push(entry);
  if (type === "hr") state.hrEvaluations.push(entry);
  else state.techEvaluations.push(entry);
}

function maybeAdaptNextQuestion(type, suggestedNextQuestion) {
  if (!suggestedNextQuestion) return;
  const questions = getQuestionList(type);
  const nextIndex = getCurrentIndex(type) + 1;
  if (!questions[nextIndex]) return;
  questions[nextIndex] = {
    ...questions[nextIndex],
    question: suggestedNextQuestion,
    difficulty: "adaptive",
    focus: type === "technical" ? "reasoning depth" : "behavioral depth"
  };
}

function incrementCurrentIndex(type) {
  if (type === "hr") {
    state.hrCurrentQ++;
    state.followUpCount = 0;
  } else {
    state.techCurrentQ++;
    state.followUpCount = 0;
  }
}

function updateProgress(type, currentOverride, totalOverride) {
  const qList = getQuestionList(type);
  const current = currentOverride ?? Math.min(getCurrentIndex(type) + 1, qList.length);
  const total = totalOverride ?? qList.length;
  const prefix = type === "hr" ? "hr" : "tech";
  document.getElementById(`${prefix}QNum`).textContent = total ? `${current}/${total}` : "0/0";
  const fill = document.getElementById(`${prefix}ProgressFill`);
  if (fill) fill.style.width = total ? `${Math.min(100, (current / total) * 100)}%` : "0%";
}

function setInterviewInputState(type, disabled, buttonText) {
  const input = getInterviewInput(type);
  const button = input?.closest(".chat-input-area")?.querySelector("button");
  if (!input || !button) return;
  input.disabled = disabled;
  button.disabled = disabled;
  button.textContent = buttonText || "Send";
}

function focusInterviewInput(type) {
  const input = getInterviewInput(type);
  if (input && !input.disabled) input.focus();
}

function getQuestionList(type) {
  return type === "hr" ? (state.hrQuestions || []) : (state.techQuestions || []);
}

function getCurrentIndex(type) {
  return type === "hr" ? state.hrCurrentQ : state.techCurrentQ;
}

function getInterviewInput(type) {
  return document.getElementById(`${type === "hr" ? "hr" : "tech"}Input`);
}

function getMessageContainer(type) {
  return document.getElementById(`${type === "hr" ? "hr" : "tech"}Messages`);
}

function scrollMessages(type) {
  const container = getMessageContainer(type);
  container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
}

function clearInterviewTimers() {
  interviewRuntime.typingTimers.forEach((timer) => window.clearTimeout(timer));
  interviewRuntime.typingTimers = [];
}

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(150, textarea.scrollHeight)}px`;
}

function escapeText(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

document.addEventListener("input", (event) => {
  if (event.target.matches("#hrInput, #techInput")) autoResizeTextarea(event.target);
});

document.addEventListener("keydown", (event) => {
  if (!event.target.matches("#hrInput, #techInput")) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitAnswer(event.target.id === "hrInput" ? "hr" : "technical");
  }
});
