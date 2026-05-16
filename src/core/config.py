import os
from pathlib import Path


class Settings:
    BASE_DIR = Path(__file__).resolve().parents[2]
    MODELS_DIR = BASE_DIR / "models"
    FAISS_INDEX_DIR = BASE_DIR / "data" / "faiss"
    EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "384"))
    CACHE_DIR = BASE_DIR / "data" / "cache"


settings = Settings()
