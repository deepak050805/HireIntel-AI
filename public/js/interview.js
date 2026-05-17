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
  const button = input?.closest(".chat-input-area")?.querySelector(".primary-cta");

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

// ===== SPEECH TO TEXT (STT) =====
const SpeechToText = {
  recognition: null,
  isListening: false,
  interimTranscript: "",
  finalTranscript: "",
  silenceTimer: null,

  init() {
    if (this.recognition) return true;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech recognition is not supported in this browser.");
      return false;
    }

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      this.recognition.onstart = () => {
        this.isListening = true;
        this.interimTranscript = "";
        this.finalTranscript = "";
        updateMicUI(true);
        this.resetSilenceTimer();
      };

      this.recognition.onresult = (event) => {
        this.resetSilenceTimer();
        let interim = "";
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            this.finalTranscript += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }

        const input = getInterviewInput(interviewRuntime.activeType);
        if (input) {
          const baseText = input.dataset.baseText || "";
          input.value = (baseText + " " + this.finalTranscript + " " + interim).trim();
          autoResizeTextarea(input);
        }
      };

      this.recognition.onerror = (err) => {
        console.error("Speech recognition error:", err.error);
        this.clearSilenceTimer();
        this.isListening = false;
        updateMicUI(false);

        if (err.error === 'not-allowed') {
          alert("Microphone permission denied. Please allow microphone access in your browser settings to use voice input.");
        }
      };

      this.recognition.onend = () => {
        this.clearSilenceTimer();
        this.isListening = false;
        updateMicUI(false);
      };

      return true;
    } catch (e) {
      console.error("Failed to initialize Speech Recognition:", e);
      return false;
    }
  },

  start() {
    if (!this.init()) return;
    if (this.isListening) return;

    // Ensure TTS is stopped before opening microphone
    if (TextToSpeech.isSpeaking) {
      TextToSpeech.stop();
    }

    const input = getInterviewInput(interviewRuntime.activeType);
    if (input) {
      input.dataset.baseText = input.value;
    }

    try {
      this.recognition.start();
    } catch (e) {
      console.error("Speech recognition start failed:", e);
    }
  },

  stop() {
    if (!this.recognition || !this.isListening) return;
    try {
      this.recognition.stop();
    } catch (e) {
      console.error("Speech recognition stop failed:", e);
    }
  },

  resetSilenceTimer() {
    this.clearSilenceTimer();
    // Only auto-submit in Voice Mode (continuous natural conversation)
    if (!TextToSpeech.voiceModeActive) return;

    this.silenceTimer = setTimeout(() => {
      console.log("Speech silence detected. Stopping mic and submitting answer.");
      this.stop();
      
      const input = getInterviewInput(interviewRuntime.activeType);
      if (input && input.value.trim().length > 0) {
        submitAnswer(interviewRuntime.activeType);
      }
    }, 4500); // 4.5 seconds of silence auto-submits
  },

  clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
};

// ===== TEXT TO SPEECH (TTS) =====
const TextToSpeech = {
  isSpeaking: false,
  voiceModeActive: localStorage.getItem("hireintel_voice_mode") === "true",

  init() {
    if (!('speechSynthesis' in window)) {
      console.warn("Speech synthesis is not supported in this browser.");
      return false;
    }
    return true;
  },

  speak(text) {
    if (!this.voiceModeActive) return;
    if (!this.init()) return;

    // Pause listening while AI is talking
    SpeechToText.stop();

    try {
      window.speechSynthesis.cancel();

      // Strip markup/markdown if any for cleaner synthesis
      const cleanText = text.replace(/[*_`#]/g, '').trim();
      const utterance = new SpeechSynthesisUtterance(cleanText);

      // Find professional voice
      const voices = window.speechSynthesis.getVoices();
      let selectedVoice = voices.find(v => v.lang.startsWith("en-") && (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Apple") || v.name.includes("Microsoft")));
      if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.startsWith("en-"));
      }

      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.pitch = 1.0;
      utterance.rate = 0.95; // Calm pacing

      utterance.onstart = () => {
        this.isSpeaking = true;
        updateVoiceModeUI("speaking");
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        updateVoiceModeUI("active");
        
        // Auto-start microphone once AI finishes speaking (continuous conversation)
        if (this.voiceModeActive) {
          setTimeout(() => {
            SpeechToText.start();
          }, 500); // Natural 500ms delay
        }
      };

      utterance.onerror = (e) => {
        console.error("Speech synthesis utterance error:", e);
        this.isSpeaking = false;
        updateVoiceModeUI("active");
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("Speech synthesis failed:", e);
      this.isSpeaking = false;
      updateVoiceModeUI("active");
    }
  },

  stop() {
    if (!this.init()) return;
    try {
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
      updateVoiceModeUI(this.voiceModeActive ? "active" : "muted");
    } catch (e) {
      console.error("Failed to cancel speech synthesis:", e);
    }
  },

  toggleVoiceMode() {
    this.voiceModeActive = !this.voiceModeActive;
    interviewRuntime.voiceMode = this.voiceModeActive;
    localStorage.setItem("hireintel_voice_mode", this.voiceModeActive);

    if (this.voiceModeActive) {
      updateVoiceModeUI("active");
      this.speak("Voice mode activated. I will read the questions and feedback aloud.");
    } else {
      this.stop();
      SpeechToText.stop();
      updateVoiceModeUI("muted");
    }
  }
};

function updateVoiceModeUI(state) {
  const hrToggle = document.getElementById("hrVoiceToggle");
  const techToggle = document.getElementById("techVoiceToggle");

  [hrToggle, techToggle].forEach(btn => {
    if (!btn) return;
    
    btn.classList.remove("active", "speaking");
    
    if (state === "muted") {
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="opacity: 0.6;"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v1a7 7 0 0 1-14 0v-1"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
        Voice Mode (Muted)
      `;
      btn.setAttribute("aria-label", "Enable Interviewer Voice Mode");
    } else if (state === "active") {
      btn.classList.add("active");
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v1a7 7 0 0 1-14 0v-1"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
        Voice Mode (Active)
      `;
      btn.setAttribute("aria-label", "Mute Interviewer Voice Mode");
    } else if (state === "speaking") {
      btn.classList.add("active", "speaking");
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v1a7 7 0 0 1-14 0v-1"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
        Voice Mode (Speaking...)
      `;
      btn.setAttribute("aria-label", "Mute Interviewer Voice Mode (AI is speaking)");
    }
  });
}

function updateMicUI(isListening) {
  const hrMic = document.getElementById("hrMicBtn");
  const techMic = document.getElementById("techMicBtn");

  [hrMic, techMic].forEach(btn => {
    if (!btn) return;
    
    if (isListening) {
      btn.classList.add("recording");
      btn.setAttribute("aria-label", "Stop recording voice input");
      btn.title = "Stop microphone";
    } else {
      btn.classList.remove("recording");
      btn.setAttribute("aria-label", "Start recording voice input");
      btn.title = "Use microphone";
    }
  });
}

function initVoiceSystem() {
  const hrToggle = document.getElementById("hrVoiceToggle");
  const techToggle = document.getElementById("techVoiceToggle");
  const hrMic = document.getElementById("hrMicBtn");
  const techMic = document.getElementById("techMicBtn");

  // Sync state initially
  const initialMode = localStorage.getItem("hireintel_voice_mode") === "true";
  interviewRuntime.voiceMode = initialMode;
  TextToSpeech.voiceModeActive = initialMode;

  updateVoiceModeUI(initialMode ? "active" : "muted");

  // Reset listeners cleanly by replacing elements
  [hrToggle, techToggle].forEach(btn => {
    if (btn) {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", () => {
        TextToSpeech.toggleVoiceMode();
      });
    }
  });

  [hrMic, techMic].forEach(btn => {
    if (btn) {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", () => {
        if (SpeechToText.isListening) {
          SpeechToText.stop();
        } else {
          SpeechToText.start();
        }
      });
    }
  });

  if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }
}

function speakAI(text) {
  TextToSpeech.speak(text);
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

    const followUpQuestion = getAllowedFollowUp(normalizedType, res.data.followUpQuestion, res.data.signals?.answerQuality);
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
  if (sender === "ai") {
    setTimeout(() => speakAI(text), 150);
  }
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

function getAllowedFollowUp(type, followUpQuestion, qualityLabel) {
  if (!followUpQuestion) return "";
  const maxFollowUps = qualityLabel === "thin" ? 2 : 1;
  if (state.followUpCount >= maxFollowUps) {
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
  const button = input?.closest(".chat-input-area")?.querySelector(".primary-cta");
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

const scrollAnimationActive = {};

function scrollMessages(type) {
  const container = getMessageContainer(type);
  if (!container) return;

  const targetScrollTop = container.scrollHeight - container.clientHeight;
  const startScrollTop = container.scrollTop;
  const distance = targetScrollTop - startScrollTop;
  if (distance <= 0) return;

  if (scrollAnimationActive[type]) {
    cancelAnimationFrame(scrollAnimationActive[type]);
  }

  const duration = 400; // ms
  let startTime = null;

  function easeOutQuad(t) {
    return t * (2 - t);
  }

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    const progress = timestamp - startTime;
    const percentage = Math.min(progress / duration, 1);
    
    container.scrollTop = startScrollTop + distance * easeOutQuad(percentage);

    if (percentage < 1) {
      scrollAnimationActive[type] = requestAnimationFrame(step);
    } else {
      container.scrollTop = targetScrollTop;
      scrollAnimationActive[type] = null;
    }
  }

  const interrupt = () => {
    if (scrollAnimationActive[type]) {
      cancelAnimationFrame(scrollAnimationActive[type]);
      scrollAnimationActive[type] = null;
    }
    container.removeEventListener("wheel", interrupt);
    container.removeEventListener("touchstart", interrupt);
  };

  container.addEventListener("wheel", interrupt, { passive: true });
  container.addEventListener("touchstart", interrupt, { passive: true });

  scrollAnimationActive[type] = requestAnimationFrame(step);
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
