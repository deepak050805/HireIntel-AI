from pathlib import Path
import sys
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import threading
from dotenv import load_dotenv

# Ensure src is on path so imports resolve when run directly
ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SRC_DIR))

# Load environment variables
load_dotenv()

from src.ml_logic.parser import parse_resume
from src.ml_logic.ats_analyzer import analyze_ats
from src.ml_logic.job_matcher import match_jobs
# Interview model and LLM imports are heavy; import lazily inside handlers
# from src.ml_logic.interview_engine import generate_questions, evaluate_answer, init_interview_model
from src.core.logger import get_logger

logger = get_logger('app')

from src.ml_logic.faiss_service import get_faiss_service
from src import storage


PUBLIC_DIR = ROOT / 'public'

app = Flask(__name__, static_folder=str(PUBLIC_DIR))
CORS(app)

@app.route('/')
def index():
    return send_from_directory(PUBLIC_DIR, 'index.html')

@app.route('/<path:path>')
def static_proxy(path):
    return send_from_directory(PUBLIC_DIR, path)

@app.route('/api/upload', methods=['POST'])
def upload():
    if 'resume' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files['resume']
    try:
        text = parse_resume(file.read(), file.filename)
    except Exception as e:
        logger.exception("Failed to parse resume: %s", e)
        return jsonify({"error": "Failed to parse resume"}), 500
    
    return jsonify({
        "success": True,
        "resumeText": text
    })

@app.route('/api/analyze/ats', methods=['POST'])
def ats_route():
    """Analyze resume with ATS scoring. Expects JSON `{"resumeText": "..."}`."""
    data = request.get_json(silent=True) or {}
    if 'resumeText' not in data:
        return jsonify({"success": False, "error": "resumeText is required"}), 400
    try:
        result = analyze_ats(data['resumeText'])
    except Exception as e:
        logger.exception("ATS analysis failed: %s", e)
        return jsonify({"error": "ATS analysis failed"}), 500
    return jsonify({"success": True, "data": result})

@app.route('/api/analyze/jobs', methods=['POST'])
def jobs_route():
    """Match resume to job roles. Expects JSON `{"resumeText": "..."}`."""
    data = request.get_json(silent=True) or {}
    if 'resumeText' not in data:
        return jsonify({"success": False, "error": "resumeText is required"}), 400
    try:
        result = match_jobs(data['resumeText'])
    except Exception as e:
        logger.exception("Job matching failed: %s", e)
        return jsonify({"error": "Job matching failed"}), 500
    return jsonify({"success": True, "data": result})

@app.route('/api/analyze/gaps', methods=['POST'])
def gaps_route():
    """Return missing sections and assessment using ATS analysis. Expects `{resumeText}`."""
    data = request.get_json(silent=True) or {}
    if 'resumeText' not in data:
        return jsonify({"success": False, "error": "resumeText is required"}), 400
    result = analyze_ats(data['resumeText'])
    return jsonify({
        "success": True, 
        "data": {
            "missingSections": [{"section": issue, "importance": "high"} for issue in result['categories']['formatting']['issues']],
            "overallAssessment": result['summary']
        }
    })

@app.route('/api/interview/start', methods=['POST'])
def interview_start():
    """Generate interview questions. Expects `{resumeText, type, context?}`."""
    data = request.get_json(silent=True) or {}
    resume_text = (data.get('resumeText') or '').strip()
    interview_type = (data.get('type') or 'hr').strip().lower()
    if not resume_text:
        return jsonify({"success": False, "error": "resumeText is required"}), 400
    if interview_type not in ('hr', 'technical', 'tech'):
        return jsonify({"success": False, "error": "type must be hr or technical"}), 400
    try:
        from src.ml_logic.interview_engine import generate_questions
        logger.info(
            "Interview start requested. type=%s resume_chars=%s context_keys=%s",
            interview_type,
            len(resume_text),
            list((data.get('context') or {}).keys())
        )
        result = generate_questions(resume_text, interview_type, data.get('context') or {})
    except Exception as e:
        logger.exception("Interview start failed: %s", e)
        return jsonify({
            "success": False,
            "error": "We could not start the interview session. Please try again."
        }), 500
    return jsonify({"success": True, "data": result})

@app.route('/api/interview/evaluate', methods=['POST'])
def interview_eval():
    """Evaluate an answer. Expects `{question, answer, type?, history?, context?, resumeText?}`."""
    data = request.get_json(silent=True) or {}
    if not (data.get('question') or '').strip() or not (data.get('answer') or '').strip():
        return jsonify({"success": False, "error": "question and answer are required"}), 400
    try:
        from src.ml_logic.interview_engine import evaluate_answer
        result = evaluate_answer(
            data['question'],
            data['answer'],
            data.get('type', 'hr'),
            data.get('history') or [],
            data.get('context') or {},
            data.get('resumeText') or ''
        )
    except Exception as e:
        logger.exception("Interview eval failed: %s", e)
        return jsonify({
            "success": False,
            "error": "We could not evaluate that answer. Please try again."
        }), 500
    return jsonify({"success": True, "data": result})

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "HireIntel"}), 200


@app.route('/api/search_candidates', methods=['POST'])
def search_candidates():
    data = request.json or {}
    query = data.get('query')
    k = int(data.get('k', 10))
    if not query:
        return jsonify({"error": "query is required"}), 400
    try:
        svc = get_faiss_service()
        results = svc.search(query, k=k)
        return jsonify({"success": True, "data": results})
    except Exception as e:
        logger.exception("search_candidates failed: %s", e)
        return jsonify({"error": "search failed"}), 500


@app.route('/api/rank_candidates', methods=['POST'])
def rank_candidates():
    data = request.json or {}
    jd = data.get('jobDescription')
    candidate_ids = data.get('candidateIds')
    k = int(data.get('k', 10))
    if not jd:
        return jsonify({"error": "jobDescription is required"}), 400
    try:
        svc = get_faiss_service()
        ranked = svc.rank_candidates(jd, candidate_ids=candidate_ids, top_k=k)
        return jsonify({"success": True, "data": ranked})
    except Exception as e:
        logger.exception("rank_candidates failed: %s", e)
        return jsonify({"error": "ranking failed"}), 500


@app.route('/api/semantic_match', methods=['POST'])
def semantic_match():
    data = request.json or {}
    resume = data.get('resumeText')
    jd = data.get('jobDescription')
    if not resume or not jd:
        return jsonify({"error": "resumeText and jobDescription are required"}), 400
    try:
        from src.ml_logic.embedder import ResumeEmbedder
        from src.ml_logic.semantic_matcher import SemanticMatcher

        embed = ResumeEmbedder()
        rvec = embed.generate_embedding(resume)
        jvec = embed.generate_embedding(jd)
        sem = SemanticMatcher.calculate_similarity(rvec, jvec)
        # keyword overlap
        jd_lower = jd.lower()
        kw_overlap = sum(1 for w in resume.lower().split() if w in jd_lower)
        kw_score = min(100, int((kw_overlap / max(1, len(jd.split()))) * 100))
        combined = round((sem * 0.7) + (kw_score * 0.3), 2)
        confidence = round(max(0.0, 1.0 - abs(sem - kw_score) / 100.0), 2)

        return jsonify({
            "success": True,
            "data": {
                "semantic": sem,
                "keyword": kw_score,
                "matchScore": combined,
                "confidence": confidence,
                "explain": {"weights": {"semantic": 0.7, "keyword": 0.3}}
            }
        })
    except Exception as e:
        logger.exception("semantic_match failed: %s", e)
        return jsonify({"error": "semantic match failed"}), 500


@app.route('/api/prefs/save', methods=['POST'])
def save_prefs():
    data = request.json or {}
    prefs = data.get('prefs')
    recruiter_id = data.get('recruiterId', 'default')
    if prefs is None:
        return jsonify({"error": "prefs is required"}), 400
    try:
        storage.save_recruiter_prefs(recruiter_id, prefs)
        return jsonify({"success": True})
    except Exception as e:
        logger.exception('save_prefs failed: %s', e)
        return jsonify({"error": "save failed"}), 500


@app.route('/api/prefs/load', methods=['GET'])
def load_prefs():
    recruiter_id = request.args.get('recruiterId', 'default')
    try:
        prefs = storage.load_recruiter_prefs(recruiter_id)
        return jsonify({"success": True, "data": prefs})
    except Exception as e:
        logger.exception('load_prefs failed: %s', e)
        return jsonify({"error": "load failed"}), 500


@app.route('/api/session/save', methods=['POST'])
def save_session():
    data = request.json or {}
    session_id = data.get('sessionId')
    recruiter_id = data.get('recruiterId', 'default')
    payload = data.get('payload')
    if not session_id or payload is None:
        return jsonify({"error": "sessionId and payload are required"}), 400
    try:
        storage.save_session(session_id, recruiter_id, payload)
        return jsonify({"success": True})
    except Exception as e:
        logger.exception('save_session failed: %s', e)
        return jsonify({"error": "save failed"}), 500


@app.route('/api/session/load', methods=['GET'])
def load_session():
    session_id = request.args.get('sessionId')
    if not session_id:
        return jsonify({"error": "sessionId required"}), 400
    try:
        sess = storage.load_session(session_id)
        return jsonify({"success": True, "data": sess})
    except Exception as e:
        logger.exception('load_session failed: %s', e)
        return jsonify({"error": "load failed"}), 500


@app.route('/api/candidate/note', methods=['POST'])
def candidate_note():
    data = request.json or {}
    candidate_id = data.get('candidateId')
    note = data.get('note')
    recruiter_id = data.get('recruiterId', 'default')
    if not candidate_id or note is None:
        return jsonify({"error": "candidateId and note are required"}), 400
    try:
        storage.add_candidate_note(candidate_id, recruiter_id, note, data.get('meta'))
        # record activity event
        try:
            storage.add_event('note_added', recruiter_id, candidate_id, {'note': note})
        except Exception:
            pass
        return jsonify({"success": True})
    except Exception as e:
        logger.exception('candidate_note failed: %s', e)
        return jsonify({"error": "save failed"}), 500


@app.route('/api/candidate/notes', methods=['GET'])
def candidate_notes():
    candidate_id = request.args.get('candidateId')
    if not candidate_id:
        return jsonify({"error": "candidateId required"}), 400
    try:
        notes = storage.get_candidate_notes(candidate_id)
        return jsonify({"success": True, "data": notes})
    except Exception as e:
        logger.exception('candidate_notes failed: %s', e)
        return jsonify({"error": "load failed"}), 500


@app.route('/api/pipeline/update', methods=['POST'])
def pipeline_update():
    data = request.json or {}
    candidate_id = data.get('candidateId')
    stage = data.get('stage')
    recruiter_id = data.get('recruiterId', 'default')
    if not candidate_id or not stage:
        return jsonify({"error": "candidateId and stage are required"}), 400
    try:
        storage.update_pipeline(candidate_id, stage, recruiter_id, data.get('meta'))
        try:
            storage.add_event('moved_stage', recruiter_id, candidate_id, {'stage': stage})
        except Exception:
            pass
        return jsonify({"success": True})
    except Exception as e:
        logger.exception('pipeline_update failed: %s', e)
        return jsonify({"error": "update failed"}), 500


@app.route('/api/pipeline/list', methods=['GET'])
def pipeline_list():
    recruiter_id = request.args.get('recruiterId')
    try:
        items = storage.get_pipeline(recruiter_id)
        return jsonify({"success": True, "data": items})
    except Exception as e:
        logger.exception('pipeline_list failed: %s', e)
        return jsonify({"error": "load failed"}), 500


@app.route('/api/saved_search/save', methods=['POST'])
def saved_search_save():
    data = request.json or {}
    name = data.get('name')
    payload = data.get('payload')
    recruiter_id = data.get('recruiterId', 'default')
    if not name or payload is None:
        return jsonify({"error": "name and payload are required"}), 400
    try:
        storage.save_search(recruiter_id, name, payload)
        try:
            storage.add_event('saved_search', recruiter_id, None, {'name': name, 'payload': payload})
        except Exception:
            pass
        return jsonify({"success": True})
    except Exception as e:
        logger.exception('saved_search_save failed: %s', e)
        return jsonify({"error": "save failed"}), 500


@app.route('/api/activity/emit', methods=['POST'])
def activity_emit():
    data = request.json or {}
    etype = data.get('type')
    recruiter_id = data.get('recruiterId', 'default')
    candidate_id = data.get('candidateId')
    payload = data.get('payload')
    if not etype:
        return jsonify({"error": "type is required"}), 400
    try:
        storage.add_event(etype, recruiter_id, candidate_id, payload)
        return jsonify({"success": True})
    except Exception as e:
        logger.exception('activity_emit failed: %s', e)
        return jsonify({"error": "emit failed"}), 500


@app.route('/api/activity/recent', methods=['GET'])
def activity_recent():
    try:
        limit = int(request.args.get('limit', 50))
        items = storage.get_recent_events(limit)
        return jsonify({"success": True, "data": items})
    except Exception as e:
        logger.exception('activity_recent failed: %s', e)
        return jsonify({"error": "load failed"}), 500


@app.route('/api/candidate/timeline', methods=['GET'])
def candidate_timeline():
    candidate_id = request.args.get('candidateId')
    if not candidate_id:
        return jsonify({"error": "candidateId required"}), 400
    try:
        items = storage.get_events_for_candidate(candidate_id)
        # include candidate notes stored separately
        notes = storage.get_candidate_notes(candidate_id)
        # merge and sort
        combined = []
        for it in items:
            combined.append({ 'type': it['event_type'], 'payload': it.get('payload', {}), 'created_at': it['created_at'] })
        for n in notes:
            combined.append({ 'type': 'note_added', 'payload': {'note': n['note_text']}, 'created_at': n['created_at'] })
        combined.sort(key=lambda x: x['created_at'], reverse=True)
        return jsonify({"success": True, "data": combined})
    except Exception as e:
        logger.exception('candidate_timeline failed: %s', e)
        return jsonify({"error": "load failed"}), 500


@app.route('/api/saved_search/list', methods=['GET'])
def saved_search_list():
    recruiter_id = request.args.get('recruiterId', 'default')
    try:
        items = storage.list_saved_searches(recruiter_id)
        return jsonify({"success": True, "data": items})
    except Exception as e:
        logger.exception('saved_search_list failed: %s', e)
        return jsonify({"error": "load failed"}), 500


@app.route('/api/saved_search/delete', methods=['POST'])
def saved_search_delete():
    data = request.json or {}
    sid = data.get('id')
    if not sid:
        return jsonify({"error": "id is required"}), 400
    try:
        storage.delete_saved_search(int(sid))
        return jsonify({"success": True})
    except Exception as e:
        logger.exception('saved_search_delete failed: %s', e)
        return jsonify({"error": "delete failed"}), 500

if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 HireIntel - Professional Edition (Offline)")
    print("="*60)
    # Pre-load heavy interview model optionally to speed first inference.
    # Set PRELOAD_MODELS=1 in the environment to enable background preloading.
    if os.getenv('PRELOAD_MODELS', '0') == '1':
        print("📦 Loading Qwen2.5-0.5B model in background...")
        print("   (First startup takes 1-2 minutes, then it's cached)")
        print()

        # Pre-load model in background thread
        def preload_model():
            try:
                from src.ml_logic.interview_engine import init_interview_model
                init_interview_model()
            except Exception as e:
                logger.exception("Model pre-loading failed: %s", e)

        preload_thread = threading.Thread(target=preload_model, daemon=True)
        preload_thread.start()

    logger.info("Server starting on port %s", os.getenv('PORT', 5000))
    app.run(port=int(os.getenv('PORT', 5000)), debug=False, use_reloader=False)


@app.errorhandler(Exception)
def handle_exception(e):
    # Generic JSON error handler to ensure APIs always return structured JSON
    logger.exception("Unhandled exception: %s", e)
    return jsonify({"success": False, "error": str(e)}), 500
