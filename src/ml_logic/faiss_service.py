import os
import faiss
import numpy as np
import pickle
from typing import List, Dict, Any
from pathlib import Path
from ..core.config import settings
from .embedder import ResumeEmbedder
from ..core.logger import get_logger

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

        if self.index_path.exists():
            try:
                logger.info("Loading FAISS index from %s", self.index_path)
                self.index = faiss.read_index(str(self.index_path))
                with open(self.meta_path, 'rb') as f:
                    self.id_to_meta = pickle.load(f)
                if self.id_to_meta:
                    self.id_counter = max(self.id_to_meta.keys()) + 1
            except Exception as e:
                logger.exception("Failed to load index: %s", e)
                self._create_index()
        else:
            self._create_index()

    def _create_index(self):
        logger.info("Creating new FAISS index with dim=%s", self.dim)
        # Use IndexFlatIP and normalize vectors before adding
        self.index = faiss.IndexFlatIP(self.dim)

    def save(self):
        try:
            faiss.write_index(self.index, str(self.index_path))
            with open(self.meta_path, 'wb') as f:
                pickle.dump(self.id_to_meta, f)
            logger.info("FAISS index and metadata saved")
        except Exception as e:
            logger.exception("Failed to save index: %s", e)

    def add_candidates(self, candidates: List[Dict[str, Any]]):
        """Add a batch of candidates. Each candidate must have 'id' and 'resumeText' and optional metadata."""
        texts = [c['resumeText'] for c in candidates]
        vectors = np.array(self.embedder.generate_embedding('||'.join(texts))) if False else None
        # If the embedder has a loaded model, use batch encoding for speed.
        if getattr(self.embedder, 'model', None) is not None:
            try:
                vecs = self.embedder.model.encode(texts)
                arr = np.vstack([np.array(v, dtype='float32') for v in vecs])
            except Exception:
                vecs = [self.embedder.generate_embedding(t) for t in texts]
                arr = np.vstack([np.array(v, dtype='float32') for v in vecs])
        else:
            # generate embeddings individually to use caching or fallback
            vecs = [self.embedder.generate_embedding(t) for t in texts]
            arr = np.vstack([np.array(v, dtype='float32') for v in vecs])
        faiss.normalize_L2(arr)

        n_before = self.index.ntotal
        self.index.add(arr)

        # assign metadata ids for each added vector
        for i, cand in enumerate(candidates):
            self.id_to_meta[n_before + i] = {
                'candidate_id': cand.get('id'),
                'meta': cand.get('meta', {})
            }

        self.id_counter = n_before + len(candidates)
        self.save()
        logger.info("Added %s candidates to index", len(candidates))

    def add_candidate(self, candidate: Dict[str, Any]):
        self.add_candidates([candidate])

    def search(self, query_text: str, k: int = 10):
        try:
            qv = np.array(self.embedder.generate_embedding(query_text), dtype='float32')
            qv = np.expand_dims(qv, axis=0)
            faiss.normalize_L2(qv)
            D, I = self.index.search(qv, k)
            results = []
            for score, idx in zip(D[0], I[0]):
                if idx < 0:
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
            logger.exception("FAISS search failed: %s", e)
            return []

    def rank_candidates(self, job_description: str, candidate_ids: List[Any] = None, top_k: int = 10):
        # Search using job_description and optionally filter candidate_ids
        results = self.search(job_description, k=top_k if not candidate_ids else max(top_k, len(candidate_ids)))
        if candidate_ids:
            results = [r for r in results if r.get('candidate_id') in set(candidate_ids)]
        # produce explainable breakdown: semantic score = score; keyword score via simple overlap
        ranked = []
        for r in results[:top_k]:
            sem = r['score'] * 100.0
            # simple keyword overlap
            jd_lower = job_description.lower()
            meta = r.get('meta') or {}
            # compute keyword score from meta.skills if present
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
