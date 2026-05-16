import hashlib
import pickle
from pathlib import Path
from ..core.config import settings
import os
import math


class ResumeEmbedder:
    def __init__(self, model_name=None):
        self.model_name = model_name or settings.EMBEDDING_MODEL
        self.model = None
        self.cache_dir = settings.CACHE_DIR
        os.makedirs(self.cache_dir, exist_ok=True)
        # Lazy import to avoid heavy deps during test collection
        try:
            from sentence_transformers import SentenceTransformer

            self.model = SentenceTransformer(self.model_name)
        except Exception:
            # Leave self.model as None; generate deterministic fallback embeddings
            self.model = None

    def _cache_path(self, text: str) -> Path:
        h = hashlib.md5(text.encode('utf-8')).hexdigest()
        return Path(self.cache_dir) / f"embed_{h}.pkl"

    def _fallback_embedding(self, text: str):
        # deterministic pseudo-embedding based on sha256 digest
        import hashlib as _hash

        digest = _hash.sha256(text.encode('utf-8')).digest()
        dim = settings.EMBEDDING_DIM
        vec = []
        for i in range(dim):
            b = digest[i % len(digest)]
            vec.append((b / 255.0) * 2 - 1)
        # normalize
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def generate_embedding(self, text: str, use_cache: bool = True):
        cp = self._cache_path(text)
        if use_cache and cp.exists():
            try:
                with open(cp, 'rb') as f:
                    return pickle.load(f)
            except Exception:
                pass

        if self.model is not None:
            vec = self.model.encode(text)
        else:
            vec = self._fallback_embedding(text)

        if use_cache:
            try:
                with open(cp, 'wb') as f:
                    pickle.dump(vec, f)
            except Exception:
                pass
        return vec