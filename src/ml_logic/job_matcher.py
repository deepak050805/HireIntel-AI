"""
Job matcher using semantic embeddings + keyword signals.
Generates explainable match percentages and reasoning for recruiter use.
"""
from .embedder import ResumeEmbedder
from .semantic_matcher import SemanticMatcher
from ..core.logger import get_logger

logger = get_logger('job_matcher')


JOB_PROFILES = [
    {"title": "Software Engineer", "description": "Developing web applications, backend services, Python, Java, SQL, and Git."},
    {"title": "Data Scientist", "description": "Machine learning, data analysis, Python, R, statistics, and visualization."},
    {"title": "Frontend Developer", "description": "Building user interfaces, HTML, CSS, Javascript, React, and UI/UX design."},
    {"title": "DevOps Engineer", "description": "Cloud infrastructure, AWS, Docker, Kubernetes, and CI/CD pipelines."},
    {"title": "Project Manager", "description": "Planning, leadership, agile, communication, and stakeholder management."},
    {"title": "Business Analyst", "description": "Requirement gathering, data documentation, and business process improvement."},
]

_embedder = ResumeEmbedder()


def match_jobs(resume_text, top_k=5):
    """Return top_k job profile matches with semantic similarity and keyword overlap.

    Returns: {"topRoles": [ {title, matchPercentage, reasoning, breakdown}, ... ] }
    """
    try:
        resume_vec = _embedder.generate_embedding(resume_text)
    except Exception as e:
        logger.exception("Embedding resume failed: %s", e)
        return {"topRoles": []}

    results = []
    for job in JOB_PROFILES:
        jd = job['description']
        try:
            jd_vec = _embedder.generate_embedding(jd)
        except Exception as e:
            logger.exception("Embedding job desc failed: %s", e)
            jd_vec = resume_vec

        semantic_score = SemanticMatcher.calculate_similarity(resume_vec, jd_vec)

        # keyword overlap (simple but interpretable)
        resume_lower = resume_text.lower()
        keywords = [w for w in jd.lower().split(',') if w.strip()]
        overlap = sum(1 for k in keywords if k.strip() and k.strip() in resume_lower)
        keyword_score = min(100, int((overlap / max(1, len(keywords))) * 100))

        # combine signals (weights tuned for recruiter precision)
        combined = round((semantic_score * 0.7) + (keyword_score * 0.3), 2)

        reasoning = f"Semantic similarity {semantic_score}%; keyword overlap {keyword_score}%"
        breakdown = {
            "semantic": semantic_score,
            "keyword": keyword_score
        }

        results.append({
            "title": job['title'],
            "matchPercentage": combined,
            "reasoning": reasoning,
            "breakdown": breakdown,
            "industry": "Technology"
        })

    results = sorted(results, key=lambda x: x['matchPercentage'], reverse=True)
    return {"topRoles": results[:top_k]}
