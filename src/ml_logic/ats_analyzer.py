import re
import numpy as np
from .embedder import ResumeEmbedder
from .semantic_matcher import SemanticMatcher
from ..core.logger import get_logger

logger = get_logger('ats')

# Pre-compiled regex patterns for faster matching
SKILL_KEYWORDS = {
    'technical': ['python', 'javascript', 'react', 'node', 'java', 'sql', 'aws', 'docker', 'machine learning', 'api', 'git', 'html', 'css', 'c++', 'c#'],
    'soft': ['leadership', 'communication', 'teamwork', 'problem solving', 'management', 'agile', 'critical thinking']
}

SECTIONS = ['experience', 'education', 'skills', 'projects', 'contact', 'summary', 'languages']

# Pre-compile regex for faster matching
PERCENTAGE_PATTERN = re.compile(r'\d+')
METRIC_PATTERN = re.compile(r'\d+[xX]|\d+\+')

# reuse embedder instance
_embedder = ResumeEmbedder()


def _cos_sim(a, b):
    a = np.array(a, dtype='float32')
    b = np.array(b, dtype='float32')
    if np.linalg.norm(a) == 0 or np.linalg.norm(b) == 0:
        return 0.0
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def analyze_ats(text):
    """Hybrid ATS analysis: combines rule-based and semantic embeddings for robust scoring."""
    if not text:
        return {
            "overallScore": 0,
            "categories": {},
            "summary": "No resume text provided."
        }

    text_lower = text.lower()

    # Structural / formatting checks
    found_sections = [s for s in SECTIONS if s in text_lower]
    section_score = (len(found_sections) / len(SECTIONS)) * 100

    # Keyword checks
    found_tech = [k for k in SKILL_KEYWORDS['technical'] if k in text_lower]
    found_soft = [k for k in SKILL_KEYWORDS['soft'] if k in text_lower]
    keyword_score = min(100, (len(found_tech) * 12 + len(found_soft) * 6))

    # Metrics detection
    impact_matches = PERCENTAGE_PATTERN.findall(text)
    metric_matches = METRIC_PATTERN.findall(text)
    impact_score = min(100, (len(impact_matches) + len(metric_matches)) * 12)

    # Semantic matching against canonical skills for improved recall
    skills = SKILL_KEYWORDS['technical'] + SKILL_KEYWORDS['soft']
    try:
        resume_vec = _embedder.generate_embedding(text)
        skill_vecs = [_embedder.generate_embedding(s) for s in skills]
        sims = [_cos_sim(resume_vec, sv) for sv in skill_vecs]
        semantic_skill_score = float(np.mean(sims)) * 100
    except Exception as e:
        logger.exception("Semantic embedding failed: %s", e)
        semantic_skill_score = keyword_score

    # Weighted combination
    overall_score = (section_score * 0.25) + (keyword_score * 0.2) + (impact_score * 0.2) + (semantic_skill_score * 0.35)

    missing_sections = [f"Missing {s}" for s in SECTIONS if s not in found_sections]
    formatting_feedback = "Structure looks good" if len(found_sections) > 4 else "Consider adding more standard sections"

    # Confidence estimation: agreement between semantic and keyword signals
    try:
        agreement = abs(semantic_skill_score - keyword_score) / 100.0
        confidence = max(0.0, 1.0 - agreement)  # closer signals => higher confidence
        confidence = round(confidence, 2)
    except Exception:
        confidence = 0.6

    return {
        "overallScore": round(overall_score),
        "confidence": confidence,
        "categories": {
            "formatting": {
                "score": round(section_score),
                "feedback": formatting_feedback,
                "issues": missing_sections[:3]
            },
            "keywords": {
                "score": round(keyword_score),
                "detectedKeywords": found_tech + found_soft,
                "missingCommon": [k for k in SKILL_KEYWORDS['technical'] if k not in found_tech][:5]
            },
            "semantic": {
                "score": round(semantic_skill_score),
                "notes": "Semantic matching improves recall for synonyms and contextual mentions"
            },
            "experience": {
                "score": round(impact_score),
                "feedback": "Include more numbers and metrics" if not impact_matches else "Good use of metrics"
            }
        },
        "summary": f"Hybrid ATS score: {round(overall_score)} — combines format, keywords, and semantic matches.",
        "explain": {
            "weights": {"formatting": 0.25, "keyword": 0.2, "experience": 0.2, "semantic": 0.35},
            "notes": "Overall computed as weighted combination; confidence near 1.0 indicates agreement between semantic and keyword signals."
        }
    }
