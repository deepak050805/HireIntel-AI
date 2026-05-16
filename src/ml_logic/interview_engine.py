"""
Interview Engine - resume-aware question generation and answer evaluation.
"""

import re

from .ats_analyzer import analyze_ats
from .llm_engine import generate_text, extract_questions_from_text, extract_score_from_text
from .qa_data import qa_knowledge_base
from .skill_ontology import SKILL_ONTOLOGY
from ..core.logger import get_logger

logger = get_logger("interview")


def generate_questions(resume_text, interview_type="hr", context=None):
    """Generate an interview session from resume intelligence.

    Uses the local LLM when available. If the model runtime is unavailable, the
    fallback is still resume-derived and role/type-specific, not generic
    placeholder content.
    """
    normalized_type = _normalize_interview_type(interview_type)
    context = context or {}
    resume_text = (resume_text or "").strip()
    if not resume_text:
        raise ValueError("resume_text is required for interview generation")

    intelligence = _build_resume_intelligence(resume_text, context)
    logger.info(
        "Generating %s interview. skills=%s ats=%s role=%s",
        normalized_type,
        intelligence["skills"][:8],
        intelligence["ats_score"],
        intelligence["role_context"][:80],
    )

    questions = []
    model_error = None
    try:
        prompt = _build_question_prompt(resume_text, normalized_type, intelligence)
        generated_text = generate_text(prompt, max_tokens=360, temperature=0.55)
        response = generated_text.split("<|assistant|>")[-1].strip() if "<|assistant|>" in generated_text else generated_text.strip()
        questions = extract_questions_from_text(response)
        logger.info("Local model generated %s interview questions", len(questions))
    except Exception as exc:
        model_error = exc
        logger.exception("Local model question generation failed; using resume-derived generator: %s", exc)

    if len(questions) < 3:
        questions = _generate_resume_derived_questions(normalized_type, intelligence)

    formatted_questions = [
        {
            "id": index + 1,
            "question": question,
            "difficulty": _difficulty_for(index, intelligence["ats_score"]),
            "focus": _focus_for_question(question, intelligence),
        }
        for index, question in enumerate(_dedupe_questions(questions)[:4])
    ]

    return {
        "questions": formatted_questions,
        "openingMessage": _opening_message(normalized_type, intelligence),
        "session": {
            "type": normalized_type,
            "skills": intelligence["skills"][:8],
            "atsScore": intelligence["ats_score"],
            "roleContext": intelligence["role_context"],
            "modelStatus": "local_llm" if model_error is None else "resume_derived",
        },
    }


def evaluate_answer(question, answer, interview_type="hr", history=None, context=None, resume_text=""):
    """Evaluate candidate answer with adaptive interviewer intelligence."""
    interview_type = _normalize_interview_type(interview_type)
    history = history or []
    context = context or {}
    question = (question or "").strip()
    answer = (answer or "").strip()
    if not question or not answer:
        raise ValueError("question and answer are required")

    answer_signals = _analyze_answer_signals(answer)
    memory = _build_conversation_memory(history, answer, context, resume_text)

    prompt = f"""<|system|>
You are a senior {interview_type} recruiter at a top-tier tech firm. 
Evaluate the candidate's answer based on the role context and previous answers.
Respond as if you are talking directly to the candidate in a real interview.
Acknowledge their answer professionally, assess their reasoning/evidence, and if they were vague, ask a short, targeted follow-up.
Always start your internal evaluation with "Score: X/10" on the first line, then provide your spoken response on the next lines.
Do not mention the score in your spoken response.
<|user|>
Role: {memory['role_context']}
Conversation History: {memory['summary']}
Question: {question}
Candidate Answer: {answer}

Interviewer response:
<|assistant|>
"""

    model_feedback = None
    try:
        generated_text = generate_text(prompt, max_tokens=180, temperature=0.45, use_qa_data=True)
        if generated_text in qa_knowledge_base.values():
            model_feedback = f"Score: 9/10\nStrong response. A strong answer would include: {generated_text}"
        elif "<|assistant|>" in generated_text:
            model_feedback = generated_text.split("<|assistant|>")[-1].strip()
        else:
            model_feedback = generated_text.strip()
        score = extract_score_from_text(model_feedback)
    except Exception as exc:
        logger.exception("Local model answer evaluation failed; using rubric fallback: %s", exc)
        score, model_feedback = _rubric_evaluate(question, answer, interview_type, answer_signals, memory)

    dimension_scores = _dimension_scores(interview_type, score, answer_signals, memory)
    follow_up = _adaptive_follow_up(interview_type, question, answer, answer_signals, memory, score)
    suggested_next = _suggest_next_question(interview_type, answer, answer_signals, memory, score)
    acknowledgment = _interviewer_acknowledgment(interview_type, answer_signals, score)
    feedback = _compose_feedback(interview_type, model_feedback, answer_signals, dimension_scores)

    return {
        "score": score,
        "feedback": _clean_feedback(feedback),
        "acknowledgment": acknowledgment,
        "followUpQuestion": follow_up,
        "suggestedNextQuestion": suggested_next,
        "dimensionScores": dimension_scores,
        "signals": {
            "mentionedTechnologies": answer_signals["technologies"],
            "behavioralThemes": answer_signals["behavioral_themes"],
            "confidence": answer_signals["confidence"],
            "specificity": answer_signals["specificity"],
            "answerQuality": answer_signals["quality_label"],
        },
        "recommendation": _answer_recommendation(interview_type, score, answer_signals),
    }


def init_interview_model():
    """Pre-load the model for faster first request."""
    try:
        from .llm_engine import load_model

        load_model()
        logger.info("Interview model pre-loaded")
    except Exception as exc:
        logger.exception("Could not pre-load model: %s", exc)


def _normalize_interview_type(interview_type):
    value = (interview_type or "hr").strip().lower()
    if value in {"technical", "tech"}:
        return "technical"
    return "hr"


def _build_resume_intelligence(resume_text, context):
    skills = _extract_skills(resume_text)
    ats_score = 0
    weak_categories = []
    try:
        ats = analyze_ats(resume_text)
        ats_score = int(ats.get("overallScore", 0))
        weak_categories = [
            name
            for name, value in (ats.get("categories") or {}).items()
            if int(value.get("score") or 0) < 75
        ]
    except Exception as exc:
        logger.exception("ATS intelligence unavailable for interview prompt: %s", exc)

    role_context = (
        context.get("roleContext")
        or context.get("jobDescription")
        or context.get("targetRole")
        or _infer_role_context(skills, resume_text)
    )

    return {
        "skills": skills,
        "ats_score": ats_score,
        "weak_categories": weak_categories,
        "role_context": role_context,
        "resume_summary": _summarize_resume(resume_text),
    }


def _extract_skills(resume_text):
    text = resume_text.lower()
    found = []
    for canonical, variants in SKILL_ONTOLOGY.items():
        terms = [canonical] + variants
        if any(re.search(rf"\b{re.escape(term.lower())}\b", text) for term in terms):
            found.append(canonical)

    common_terms = [
        "python", "java", "javascript", "typescript", "react", "flask",
        "django", "fastapi", "sql", "postgresql", "mysql", "aws", "azure",
        "docker", "kubernetes", "machine learning", "nlp", "pandas",
        "numpy", "api", "leadership", "analytics", "testing",
    ]
    for term in common_terms:
        if term in text and term not in found:
            found.append(term)

    return found[:12] or ["resume experience", "project execution", "role alignment"]


def _infer_role_context(skills, resume_text):
    text = resume_text.lower()
    if any(skill in text for skill in ["react", "javascript", "typescript", "frontend"]):
        return "frontend product engineering role"
    if any(skill in text for skill in ["python", "flask", "django", "fastapi", "api"]):
        return "backend software engineering role"
    if any(skill in text for skill in ["machine learning", "nlp", "data science", "pandas"]):
        return "AI and data-focused role"
    return f"role aligned to {', '.join(skills[:3])}"


def _summarize_resume(resume_text):
    compact = re.sub(r"\s+", " ", resume_text).strip()
    return compact[:700]


def _build_question_prompt(resume_text, interview_type, intelligence):
    if interview_type == "technical":
        instruction = (
            "Generate exactly 3 technical interview questions. Make them practical, "
            "specific to the candidate's skills, and progressively deeper."
        )
    else:
        instruction = (
            "Generate exactly 3 HR interview questions. Focus on motivation, "
            "communication, ownership, collaboration, and role alignment."
        )

    return f"""<|system|>
You are a senior {interview_type} interviewer for an AI recruitment platform.
{instruction}
Do not include answers. Number each question 1-3.
<|user|>
Target role/context: {intelligence['role_context']}
Detected skills: {', '.join(intelligence['skills'])}
ATS score: {intelligence['ats_score']}
Areas to probe: {', '.join(intelligence['weak_categories']) or 'depth and evidence'}

Resume excerpt:
{resume_text[:1800]}

Generate the questions now.
<|assistant|>
"""


def _generate_resume_derived_questions(interview_type, intelligence):
    skills = intelligence["skills"]
    primary = skills[0]
    secondary = skills[1] if len(skills) > 1 else skills[0]
    tertiary = skills[2] if len(skills) > 2 else secondary
    role = intelligence["role_context"]
    weak = intelligence["weak_categories"][0] if intelligence["weak_categories"] else "impact"

    if interview_type == "technical":
        if "flask" in skills or "api" in skills or "backend development" in skills:
            return [
                f"Walk me through a backend project where you used {primary}; what API or data-model decisions mattered most?",
                f"Imagine a Flask API endpoint is intermittently slow in production. How would you isolate the bottleneck and verify the fix?",
                f"How would you design authentication, validation, and error handling for a {role} feature using {secondary}?",
                f"What trade-off did you make in a real implementation involving {tertiary}, and how did you validate that decision?",
            ]
        if "react" in skills or "frontend development" in skills:
            return [
                f"Walk me through a React feature from state design to release. What made the implementation reliable?",
                "How would you debug a page that feels slow even though the API is responding quickly?",
                f"What trade-offs would you consider when choosing state management for a {role} product surface?",
                f"Describe how you would test and monitor a user-facing feature involving {secondary}.",
            ]
        if "machine learning" in skills or "data science" in skills:
            return [
                "Walk me through a model or data project from problem framing to evaluation. What metric mattered most?",
                "How would you detect that a model is performing well offline but poorly in production?",
                f"What trade-offs would you make when preparing data for a {role} use case?",
                "How would you explain model confidence and limitations to a non-technical stakeholder?",
            ]
        return [
            f"Walk me through a project where you used {primary}; what architecture decisions mattered most and why?",
            f"How would you design and debug a production feature for a {role}, especially around {secondary}?",
            f"Your resume suggests experience with {', '.join(skills[:3])}. What trade-off did you make in a real implementation, and how did you validate it?",
            f"If this system failed after release, what signals would you inspect first and how would you prioritize the fix?",
        ]

    return [
        f"What drew you toward a {role}, and which part of your resume best shows that direction?",
        f"Tell me about a time you had to create clarity or momentum in work involving {primary}. What did you do personally?",
        "Tell me about a moment when you disagreed with a teammate or stakeholder. How did you handle it?",
        f"Your resume has an opportunity to strengthen {weak}. How would you explain your impact and growth in that area to a hiring team?",
    ]


def _dedupe_questions(questions):
    seen = set()
    unique = []
    for question in questions:
        clean = re.sub(r"\s+", " ", question).strip()
        key = clean.lower()
        if clean and key not in seen:
            unique.append(clean)
            seen.add(key)
    return unique


def _difficulty_for(index, ats_score):
    if index == 0:
        return "medium"
    if ats_score >= 75 or index == 2:
        return "advanced"
    return "medium"


def _focus_for_question(question, intelligence):
    lower = question.lower()
    for skill in intelligence["skills"]:
        if skill.lower() in lower:
            return skill
    return "role alignment"


def _opening_message(interview_type, intelligence):
    label = "technical" if interview_type == "technical" else "HR"
    skills = ", ".join(intelligence["skills"][:3])
    role = intelligence["role_context"]
    if interview_type == "technical":
        return (
            f"Hi there. I've been reviewing your background, particularly your work with {skills}. "
            f"For this {role} role, I'd like to dive into some practical scenarios and see how you approach complex problems. Ready?"
        )
    return (
        f"Hello. It's a pleasure to meet you. I've looked over your experience and it seems you've spent significant time with {skills}. "
        f"I'm interested in learning more about your approach to {role} challenges and your general work style. Shall we begin?"
    )


def _analyze_answer_signals(answer):
    text = answer.lower()
    words = re.findall(r"\w+", text)
    unique_words = set(words)
    technologies = [term for term in [
        "python", "flask", "django", "fastapi", "sql", "react", "typescript",
        "javascript", "aws", "docker", "kubernetes", "machine learning", "nlp",
        "api", "testing", "analytics"
    ] if term in text]
    behavioral_themes = [term for term in [
        "team", "collaboration", "conflict", "stakeholder", "leadership",
        "pressure", "stress", "ownership", "mentored", "feedback", "deadline"
    ] if term in text]
    evidence_terms = {"built", "led", "improved", "measured", "designed", "debugged", "shipped", "reduced", "increased", "owned", "launched"}
    uncertainty_terms = {"maybe", "probably", "i think", "not sure", "kind of", "somewhat"}
    confident_terms = {"decided", "owned", "led", "validated", "measured", "because", "therefore"}
    specificity = min(100, (len(words) * 2) + (20 if any(char.isdigit() for char in answer) else 0) + (15 if unique_words & evidence_terms else 0))
    confidence = 58 + (12 if any(term in text for term in confident_terms) else 0) - (14 if any(term in text for term in uncertainty_terms) else 0)
    confidence = max(25, min(95, confidence + min(12, len(words) // 12)))
    quality_label = "strong" if specificity >= 75 and confidence >= 65 else "developing" if specificity >= 45 else "thin"
    return {
        "word_count": len(words),
        "technologies": technologies[:6],
        "behavioral_themes": behavioral_themes[:6],
        "has_metric": any(char.isdigit() for char in answer),
        "has_evidence": bool(unique_words & evidence_terms),
        "specificity": specificity,
        "confidence": confidence,
        "quality_label": quality_label,
    }


def _build_conversation_memory(history, answer, context, resume_text):
    """Build a rich memory of the conversation so far."""
    prior_interactions = []
    for item in history[-3:]: # Look at last 3 interactions for focused memory
        if isinstance(item, dict):
            q = item.get("question", "")[:60]
            a = item.get("answer", "")[:100]
            prior_interactions.append(f"Q: {q}... A: {a}...")
    
    memory_string = " | ".join(prior_interactions)
    
    all_answers = " ".join(str(item.get("answer", "")) for item in history if isinstance(item, dict))
    combined = f"{all_answers} {answer}"
    
    role_context = context.get("roleContext") or context.get("targetRole") or _infer_role_context(_extract_skills(resume_text or combined), resume_text or combined)
    
    signals = _analyze_answer_signals(combined)
    summary_bits = []
    if signals["technologies"]:
        summary_bits.append("Tech stack: " + ", ".join(signals["technologies"][:5]))
    if signals["behavioral_themes"]:
        summary_bits.append("Themes: " + ", ".join(signals["behavioral_themes"][:5]))
    
    return {
        "role_context": role_context,
        "summary": f"Recent: {memory_string}; Stats: {'; '.join(summary_bits)}; Confidence: {signals['confidence']}/100",
        "aggregate": signals,
    }


def _rubric_evaluate(question, answer, interview_type, signals, memory):
    words = re.findall(r"\w+", answer.lower())
    score = 5
    score += 1 if signals["has_evidence"] else 0
    score += 1 if signals["has_metric"] or signals["word_count"] >= 45 else 0
    score += 1 if signals["confidence"] >= 68 else 0
    score += 1 if interview_type == "technical" and signals["technologies"] else 0
    score += 1 if interview_type == "hr" and signals["behavioral_themes"] else 0
    if signals["word_count"] < 18:
        score -= 1
    score = max(4, min(9, score))

    if interview_type == "technical":
        feedback = (
            f"Score: {score}/10\n"
            "Useful technical direction. Strengthen it by explaining the trade-off, "
            "debugging path, and how you validated the outcome."
        )
    else:
        feedback = (
            f"Score: {score}/10\n"
            "Clear conversational direction. Strengthen it by adding the situation, "
            "the action you personally owned, and the outcome for the team or business."
        )
    if score < 7:
        feedback += " What detail would make this example more concrete?"
    return score, feedback


def _dimension_scores(interview_type, score, signals, memory):
    base = score * 10
    communication = max(35, min(96, base + (8 if signals["word_count"] >= 45 else -8)))
    confidence = signals["confidence"]
    clarity = max(35, min(96, base + (8 if signals["has_evidence"] else -6)))
    adaptability = max(35, min(94, 55 + len(signals["behavioral_themes"]) * 8 + (10 if signals["has_evidence"] else 0)))
    problem_solving = max(35, min(96, 52 + len(signals["technologies"]) * 8 + (12 if signals["has_metric"] else 0) + (10 if signals["has_evidence"] else 0)))
    leadership = max(35, min(95, 48 + len([t for t in signals["behavioral_themes"] if t in {"leadership", "ownership", "mentored", "stakeholder"}]) * 12 + (10 if signals["has_evidence"] else 0)))
    cultural_fit = max(35, min(94, 52 + len([t for t in signals["behavioral_themes"] if t in {"team", "collaboration", "feedback", "conflict"}]) * 10))
    technical_depth = max(35, min(96, problem_solving + (8 if interview_type == "technical" else -6)))
    return {
        "communication": round(communication),
        "confidence": round(confidence),
        "clarity": round(clarity),
        "adaptability": round(adaptability),
        "problemSolving": round(problem_solving),
        "leadership": round(leadership),
        "culturalFit": round(cultural_fit),
        "technicalDepth": round(technical_depth),
    }


def _adaptive_follow_up(interview_type, question, answer, signals, memory, score):
    if score >= 8 and signals["specificity"] >= 70:
        return None
    if interview_type == "hr":
        themes = set(signals["behavioral_themes"])
        if "team" in themes or "collaboration" in themes:
            return "What did you personally do to improve collaboration in that situation?"
        if "stress" in themes or "pressure" in themes or "deadline" in themes:
            return "How did you manage the pressure while keeping the quality of work high?"
        if "conflict" in themes or "stakeholder" in themes:
            return "How did you handle the disagreement while protecting the relationship?"
        if signals["confidence"] < 55:
            return "That is a fair start. What specific example would you choose if you had to show this more confidently?"
        if not signals["has_evidence"]:
            return "Can you give me a concrete example of what happened and what changed because of your action?"
    else:
        techs = set(signals["technologies"])
        if "flask" in techs or "api" in techs or "backend" in techs:
            return "Earlier you mentioned building APIs. How would you handle validation, error handling, and observability for a high-traffic production endpoint?"
        if "react" in techs or "typescript" in techs or "frontend" in techs:
            return "Regarding your frontend experience, how would you approach state management and performance optimization for a complex user interface?"
        if "machine learning" in techs or "nlp" in techs or "data" in techs:
            return "Thinking about the data pipeline you described, how would you evaluate model drift or performance degradation once it's in production?"
        if not signals["has_evidence"]:
            return "That's a good overview. Could you go deeper on a specific trade-off you made during that project and how you validated the outcome?"
    return None


def _suggest_next_question(interview_type, answer, signals, memory, score):
    if score < 6:
        return None
    if interview_type == "technical":
        if signals["technologies"]:
            tech = signals["technologies"][0]
            return f"Let us go one level deeper on {tech}. Describe a failure mode you would expect and how you would detect it early."
        return "Let us make this more concrete. Describe how you would debug the highest-risk part of that solution."
    if "leadership" in signals["behavioral_themes"] or "ownership" in signals["behavioral_themes"]:
        return "Tell me about a time your ownership changed the outcome for the team."
    if "team" in signals["behavioral_themes"] or "collaboration" in signals["behavioral_themes"]:
        return "Tell me about a team situation where you had to adapt your communication style."
    return None


def _interviewer_acknowledgment(interview_type, signals, score):
    if score >= 8:
        return "That is a strong example. I can see the ownership and structure in how you explained it."
    if interview_type == "technical" and signals["technologies"]:
        return f"That gives me a useful signal around {signals['technologies'][0]}. I want to probe the reasoning a little more."
    if interview_type == "hr" and signals["behavioral_themes"]:
        return "That is a helpful direction. I want to understand your role in the situation a bit more clearly."
    if signals["confidence"] < 55:
        return "That is a reasonable start. I am going to ask for one more detail to help ground the example."
    return "Thanks, that helps. I am looking for a little more evidence and specificity in the answer."


def _compose_feedback(interview_type, model_feedback, signals, dimension_scores):
    cleaned = _clean_feedback(model_feedback)
    additions = []
    if signals["has_metric"]:
        additions.append("The measurable detail improves credibility.")
    else:
        additions.append("Adding a metric or concrete outcome would make this stronger.")
    if interview_type == "technical":
        if dimension_scores["technicalDepth"] >= 70:
            additions.append("Technical reasoning is moving in the right direction.")
        else:
            additions.append("Go deeper on design choices, failure modes, and validation.")
    else:
        if dimension_scores["communication"] >= 70:
            additions.append("Communication is clear and easy to follow.")
        else:
            additions.append("Use a tighter situation-action-result structure.")
    return f"{cleaned} {' '.join(additions)}"


def _answer_recommendation(interview_type, score, signals):
    if score >= 8:
        return "Advance to a deeper round with role-specific probing."
    if score >= 6:
        return "Continue the interview, but ask for more concrete examples."
    if interview_type == "technical":
        return "Pause on fundamentals and validate practical reasoning before increasing difficulty."
    return "Use supportive clarification and look for stronger behavioral evidence."


def _clean_feedback(feedback):
    # Remove the internal score line "Score: X/10"
    clean = re.sub(r"Score:\s*\d+/\d+", "", feedback or "", flags=re.IGNORECASE)
    # Remove excessive whitespace
    return re.sub(r"\s+", " ", clean).strip()
