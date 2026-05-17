"""
Lightweight semantic vector database using numpy and scikit-learn.

Replaces compiled C++ binary FAISS library dependency with a pure, extremely
lightweight and CPU-optimized cosine similarity database. Fully compatible
with the original service interface signatures to avoid breaking API callers.
"""

import os
import pickle
import numpy as np
from typing import List, Dict, Any
from pathlib import Path
from ..core.config import settings
from .embedder import ResumeEmbedder
from ..core.logger import get_logger
from sklearn.metrics.pairwise import cosine_similarity

logger = get_logger('faiss_service')


class FaissService:
    def __init__(self, dim: int = None, index_path: Path = None, meta_path: Path = None):
        self.dim = dim or settings.EMBEDDING_DIM
        self.index_path = Path(index_path) if index_path else Path(settings.FAISS_INDEX_DIR) / "index.faiss"
        self.meta_path = Path(meta_path) if meta_path else Path(settings.FAISS_INDEX_DIR) / "index.meta.pkl"
        os.makedirs(self.index_path.parent, exist_ok=True)

        self.embedder = ResumeEmbedder()
        self.id_counter = 0
        self.id_to_meta: Dict[int, Dict[str, Any]] = {}
        self.vectors: List[List[float]] = []

        if self.index_path.exists():
            try:
                logger.info("Loading semantic vector index from %s", self.index_path)
                with open(self.index_path, 'rb') as f:
                    self.vectors = pickle.load(f)
                with open(self.meta_path, 'rb') as f:
                    self.id_to_meta = pickle.load(f)
                if self.id_to_meta:
                    self.id_counter = max(self.id_to_meta.keys()) + 1
            except Exception as e:
                logger.exception("Failed to load semantic vector index: %s", e)
                self.vectors = []
        else:
            self.vectors = []

    def save(self):
        try:
            with open(self.index_path, 'wb') as f:
                pickle.dump(self.vectors, f)
            with open(self.meta_path, 'wb') as f:
                pickle.dump(self.id_to_meta, f)
            logger.info("Semantic vector index and metadata saved successfully")
        except Exception as e:
            logger.exception("Failed to save semantic vector index: %s", e)

    def add_candidates(self, candidates: List[Dict[str, Any]]):
        """Add a batch of candidates using lightweight TF-IDF embeddings."""
        texts = [c['resumeText'] for c in candidates]
        vecs = [self.embedder.generate_embedding(t) for t in texts]

        n_before = len(self.vectors)
        for i, vec in enumerate(vecs):
            self.vectors.append(vec)
            self.id_to_meta[n_before + i] = {
                'candidate_id': candidates[i].get('id'),
                'meta': candidates[i].get('meta', {})
            }

        self.id_counter = n_before + len(candidates)
        self.save()
        logger.info("Added %s candidates to the semantic index", len(candidates))

    def add_candidate(self, candidate: Dict[str, Any]):
        self.add_candidates([candidate])

    def search(self, query_text: str, k: int = 10):
        """Search the TF-IDF database using standard CPU cosine similarity."""
        try:
            if not self.vectors:
                return []

            qv = self.embedder.generate_embedding(query_text)
            
            # Compute cosine similarity against all stored candidate vectors
            sims = cosine_similarity([qv], self.vectors)[0]
            
            # Retrieve indices of the top k highest matching elements
            top_indices = np.argsort(sims)[::-1][:k]

            results = []
            for idx in top_indices:
                score = sims[idx]
                # Filter out negative or zero similarity matches if any
                if score < 0:
                    continue
                meta = self.id_to_meta.get(int(idx), {})
                results.append({
                    'index': int(idx),
                    'score': float(score),
                    'candidate_id': meta.get('candidate_id'),
                    'meta': meta.get('meta')
                })
            return results
        except Exception as e:
            logger.exception("Semantic search query failed: %s", e)
            return []

    def rank_candidates(self, job_description: str, candidate_ids: List[Any] = None, top_k: int = 10):
        # Search using job_description and optionally filter candidate_ids
        results = self.search(job_description, k=top_k if not candidate_ids else max(top_k, len(candidate_ids)))
        if candidate_ids:
            results = [r for r in results if r.get('candidate_id') in set(candidate_ids)]
        
        ranked = []
        for r in results[:top_k]:
            sem = r['score'] * 100.0
            # Simple keyword overlap
            jd_lower = job_description.lower()
            meta = r.get('meta') or {}
            
            kw_score = 0.0
            skills = meta.get('skills', [])
            if skills:
                overlap = sum(1 for s in skills if s.lower() in jd_lower)
                kw_score = (overlap / len(skills)) * 100.0

            combined = round((sem * 0.75) + (kw_score * 0.25), 2)
            confidence = round(max(0.0, 1.0 - abs(sem - kw_score) / 100.0), 2)
            ranked.append({
                'candidate_id': r.get('candidate_id'),
                'semantic': round(sem, 2),
                'keyword': round(kw_score, 2),
                'matchScore': combined,
                'confidence': confidence,
                'meta': meta
            })
        return ranked


# Singleton service for app usage
_service = None


def get_faiss_service():
    global _service
    if _service is None:
        _service = FaissService()
    return _service
