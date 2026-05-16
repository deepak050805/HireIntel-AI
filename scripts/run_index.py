import sys
import json
from pathlib import Path

# Ensure package import works when running from repo root
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.ml_logic.faiss_service import get_faiss_service

p = Path(__file__).resolve().parents[0] / 'sample_candidates.json'
data = json.loads(p.read_text(encoding='utf-8'))
svc = get_faiss_service()
svc.add_candidates(data)
print('Indexed', len(data))
