"""Recruiter analytics utilities: rank candidates for a job description using semantic similarity and explainable signals."""
from .embedder import ResumeEmbedder
from .semantic_matcher import SemanticMatcher

_embedder = ResumeEmbedder()


def rank_candidates(job_description: str, candidates: list, top_k: int = 10):
    """Rank candidates.

    candidates: list of dicts {"id": ..., "resumeText": ...}
    Returns: sorted list with matchPercentage and breakdown
    """
    jd_vec = _embedder.generate_embedding(job_description)

    results = []
    for cand in candidates:
        text = cand.get('resumeText', '')
        vec = _embedder.generate_embedding(text)
        semantic = SemanticMatcher.calculate_similarity(vec, jd_vec)
        results.append({
            'id': cand.get('id'),
            'semanticMatch': semantic,
            'breakdown': {'semantic': semantic}
        })

    results = sorted(results, key=lambda x: x['semanticMatch'], reverse=True)
    return results[:top_k]
