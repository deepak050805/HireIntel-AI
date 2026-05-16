"""Batch indexer for candidate resumes using FaissService
Usage: python scripts/index_candidates.py candidates.json
candidates.json should be a list of objects with keys: id, resumeText, meta(optional)
"""
import json
import sys
from pathlib import Path
from src.ml_logic.faiss_service import get_faiss_service


def main(path):
    p = Path(path)
    if not p.exists():
        print("Candidates file not found", path)
        return 1

    data = json.loads(p.read_text())
    svc = get_faiss_service()
    svc.add_candidates(data)
    print(f"Indexed {len(data)} candidates")
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python scripts/index_candidates.py candidates.json")
        sys.exit(1)
    sys.exit(main(sys.argv[1]))
