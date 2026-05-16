from src.ml_logic.faiss_service import FaissService


def test_faiss_add_search(tmp_path):
    svc = FaissService(dim=384, index_path=tmp_path / 'index.faiss', meta_path=tmp_path / 'meta.pkl')
    candidates = [
        {"id": "cand1", "resumeText": "Experienced Python developer with Flask and SQL", "meta": {"skills": ["Python", "SQL"]}},
        {"id": "cand2", "resumeText": "Frontend engineer with React and CSS experience", "meta": {"skills": ["React", "CSS"]}}
    ]
    svc.add_candidates(candidates)
    res = svc.search("Python backend developer", k=2)
    assert len(res) >= 1
    ranked = svc.rank_candidates("Backend developer with Python and SQL", top_k=2)
    assert isinstance(ranked, list)
