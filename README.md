# HireIntel AI

> A premium, ultra-lightweight AI-powered recruitment assistant focused on semantic resume analysis, adaptive conversational interviews, and recruiter-grade candidate evaluation.

![HireIntel AI Banner](https://via.placeholder.com/1200x400/09090b/ffffff?text=HireIntel+AI)

---

## 🚀 Optimized SaaS Architecture: Ultra-Lightweight & Cloud-Friendly

HireIntel AI has been completely refactored into a **fully lightweight, CPU-optimized SaaS-style architecture** designed specifically for starter and free tiers (e.g. Render Starter/Free Plan, Railway, VPS) with low memory limits.

* **Zero Heavy AI Dependencies**: **PyTorch, HuggingFace Transformers, CUDA, and Sentence-Transformers have been entirely removed.**
* **Pure CPU Semantic Matching**: Swapped heavy vector search engines and compiled binaries with a high-performance **TF-IDF + Cosine Similarity** matching system implemented via `scikit-learn` and `numpy`.
* **Zero Model Downloads**: Embedding models are represented by a custom 384-dimensional technology/skills vocabulary map, ensuring **instant cold starts (under 3 seconds)** and zero runtime network latencies.
* **Stable cloud hosting**: The server memory footprint has been reduced to **under 60MB RAM**, guaranteeing 100% deployment stability without hitting starter resource limits.
* **Groq Cloud completions**: Preserves the complete high-fidelity recruiter chat experience, voice modes, ATS scoreboards, and conversational memory using low-latency Groq/OpenRouter completions.

---

## Core Features

### Conversational AI Interviews
* **Adaptive HR rounds**: Focus on motivation, ownership, situational behavior, and organizational fit.
* **Adaptive Technical rounds**: Deep dive into practical problem-solving, architectural choices, and technical trade-offs.
* **Intelligent Weak-Answer Probing**: Automatically detects brief, low-effort replies (e.g. *"yes"*, *"okay"*, *"idk"*) and challenges candidates for depth, evidence, and validation.
* **Conversational Memory**: Builds a context summary of the entire dialogue to enable realistic recruiters follow-up questions.

### Voice Interview Experience
* **Voice Mode**: Fully immersive conversational speech loop.
* **Interviewer Speech (TTS)**: Strips HTML and naturally translates recruiter prompts into calm, paced audio speech.
* **Mic Input (STT)**: Efficient continuous voice recognition with interim transcripts and auto-submission silence detection.

### Semantic ATS Intelligence
* **Resume Parsing**: Contextual extraction of candidate history from PDF/DOCX formats.
* **TF-IDF Semantic Match**: Custom 384-dimensional vector similarity using scikit-learn.
* **Skill & Gap Signals**: Deep resume review identifying missing sections and role fit recommendations.

---

## Technology Stack

### Frontend
* Vanilla JavaScript (ES6+), Web Speech API, and High-Performance Custom RAF Scroll Loops.
* Modern, responsive monochrome CSS architecture.

### Backend
* **Flask (Python)**: Ultra-lightweight endpoint router.
* **Scikit-Learn & Numpy**: Super-fast, lightweight vector comparison models (TF-IDF + Cosine Similarity).
* **Inference Layer**: Lightweight OpenAI-compatible request handlers (supporting Groq, OpenRouter, Together AI).

---

## Architecture Overview

```mermaid
graph TD
    User((Candidate)) -->|Browser| UI[Frontend Interface]
    UI -->|API Requests| API[Flask Backend]

    API --> Parser[Resume Parser]
    API --> ATS[ATS Analysis Engine]
    API --> TFIDF[(Lightweight TF-IDF Store)]
    API --> Engine[Interview Engine]

    Engine --> CloudLLM[Cloud AI completions: Groq / OpenRouter / Together]
    Engine --> Voice[Voice STT/TTS Layer]
```

---

## Local Development Setup

### 1. Clone & Navigate
```bash
git clone https://github.com/deepak050805/HireIntel-AI.git
cd HireIntel-AI
```

### 2. Environment Setup
Copy the production environment template:
```bash
cp .env.example .env
```
Edit `.env` to select your provider and configure API Keys:
```env
AI_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key_here
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Run Application
```bash
python src/app.py
```
Access the premium portal at [http://localhost:5000](http://localhost:5000).

---

## Docker Deployment

Build and run containerized environments with pre-loaded embeddings:
```bash
docker-compose up --build
```

---

## License

This project is intended for educational, portfolio, and demonstration purposes.

**Author**: Deepak Takshak  
AI & Data Science Engineering  
Full-Stack AI Development | NLP | Conversational Systems
