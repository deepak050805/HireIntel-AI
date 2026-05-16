from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

class SemanticMatcher:

    @staticmethod
    def calculate_similarity(resume_embedding, jd_embedding):
        similarity = cosine_similarity(
            [resume_embedding],
            [jd_embedding]
        )[0][0]

        return round(float(similarity) * 100, 2)