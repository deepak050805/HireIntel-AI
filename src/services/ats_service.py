from src.ml_logic.embedder import ResumeEmbedder
from src.ml_logic.semantic_matcher import SemanticMatcher


class ATSService:

    def __init__(self):
        self.embedder = ResumeEmbedder()

    def calculate_match_score(self, resume_text, job_description):

        resume_embedding = self.embedder.generate_embedding(resume_text)

        jd_embedding = self.embedder.generate_embedding(job_description)

        semantic_score = SemanticMatcher.calculate_similarity(
            resume_embedding,
            jd_embedding
        )

        return {
            "semantic_score": semantic_score,
            "status": "success"
        }