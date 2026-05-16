import os
import sqlite3
from pathlib import Path
import json
from typing import Optional, Any, Dict, List

DB_PATH = Path(os.getenv('HIREINTEL_DB_PATH') or Path(__file__).resolve().parents[1] / 'data' / 'hireintel.db')
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

def get_conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS recruiter_prefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recruiter_id TEXT NOT NULL,
        prefs_json TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        recruiter_id TEXT,
        session_json TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS candidate_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        recruiter_id TEXT,
        note_text TEXT,
        meta_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS activity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        recruiter_id TEXT,
        candidate_id TEXT,
        payload_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS pipeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        recruiter_id TEXT,
        meta_json TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS saved_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recruiter_id TEXT,
        name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit()
    conn.close()

def save_recruiter_prefs(recruiter_id: str, prefs: Dict[str, Any]):
    conn = get_conn()
    cur = conn.cursor()
    prefs_json = json.dumps(prefs)
    cur.execute('INSERT INTO recruiter_prefs (recruiter_id, prefs_json) VALUES (?, ?)', (recruiter_id, prefs_json))
    conn.commit()
    conn.close()

def load_recruiter_prefs(recruiter_id: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT prefs_json FROM recruiter_prefs WHERE recruiter_id = ? ORDER BY updated_at DESC LIMIT 1', (recruiter_id,))
    row = cur.fetchone()
    conn.close()
    if row:
        return json.loads(row['prefs_json'])
    return None

def save_session(session_id: str, recruiter_id: str, session_data: Dict[str, Any]):
    conn = get_conn()
    cur = conn.cursor()
    payload = json.dumps(session_data)
    cur.execute('REPLACE INTO sessions (id, recruiter_id, session_json) VALUES (?, ?, ?)', (session_id, recruiter_id, payload))
    conn.commit(); conn.close()

def load_session(session_id: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT session_json FROM sessions WHERE id = ?', (session_id,))
    row = cur.fetchone(); conn.close()
    if row:
        return json.loads(row['session_json'])
    return None

def add_candidate_note(candidate_id: str, recruiter_id: str, note_text: str, meta: Optional[Dict]=None):
    conn = get_conn(); cur = conn.cursor()
    meta_json = json.dumps(meta or {})
    cur.execute('INSERT INTO candidate_notes (candidate_id, recruiter_id, note_text, meta_json) VALUES (?, ?, ?, ?)', (candidate_id, recruiter_id, note_text, meta_json))
    conn.commit(); conn.close()

def add_event(event_type: str, recruiter_id: Optional[str]=None, candidate_id: Optional[str]=None, payload: Optional[Dict]=None):
    conn = get_conn(); cur = conn.cursor()
    payload_json = json.dumps(payload or {})
    cur.execute('INSERT INTO activity_events (event_type, recruiter_id, candidate_id, payload_json) VALUES (?, ?, ?, ?)', (event_type, recruiter_id, candidate_id, payload_json))
    conn.commit(); conn.close()

def get_recent_events(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_conn(); cur = conn.cursor()
    cur.execute('SELECT id, event_type, recruiter_id, candidate_id, payload_json, created_at FROM activity_events ORDER BY created_at DESC LIMIT ?', (limit,))
    rows = cur.fetchall(); conn.close()
    out = []
    for r in rows:
        item = dict(r)
        item['payload'] = json.loads(item.pop('payload_json') or '{}')
        out.append(item)
    return out

def get_events_for_candidate(candidate_id: str) -> List[Dict[str, Any]]:
    conn = get_conn(); cur = conn.cursor()
    cur.execute('SELECT id, event_type, recruiter_id, candidate_id, payload_json, created_at FROM activity_events WHERE candidate_id = ? ORDER BY created_at DESC', (candidate_id,))
    rows = cur.fetchall(); conn.close()
    out = []
    for r in rows:
        item = dict(r)
        item['payload'] = json.loads(item.pop('payload_json') or '{}')
        out.append(item)
    return out

def get_candidate_notes(candidate_id: str) -> List[Dict[str, Any]]:
    conn = get_conn(); cur = conn.cursor()
    cur.execute('SELECT candidate_id, recruiter_id, note_text, meta_json, created_at FROM candidate_notes WHERE candidate_id = ? ORDER BY created_at DESC', (candidate_id,))
    rows = cur.fetchall(); conn.close()
    return [dict(r) for r in rows]

def update_pipeline(candidate_id: str, stage: str, recruiter_id: str, meta: Optional[Dict]=None):
    conn = get_conn(); cur = conn.cursor()
    meta_json = json.dumps(meta or {})
    cur.execute('INSERT INTO pipeline (candidate_id, stage, recruiter_id, meta_json) VALUES (?, ?, ?, ?)', (candidate_id, stage, recruiter_id, meta_json))
    conn.commit(); conn.close()

def get_pipeline(recruiter_id: Optional[str]=None) -> List[Dict[str, Any]]:
    conn = get_conn(); cur = conn.cursor()
    if recruiter_id:
        cur.execute('SELECT candidate_id, stage, recruiter_id, meta_json, updated_at FROM pipeline WHERE recruiter_id = ? ORDER BY updated_at DESC', (recruiter_id,))
    else:
        cur.execute('SELECT candidate_id, stage, recruiter_id, meta_json, updated_at FROM pipeline ORDER BY updated_at DESC')
    rows = cur.fetchall(); conn.close()
    return [dict(r) for r in rows]

def save_search(recruiter_id: str, name: str, payload: Dict[str, Any]):
    conn = get_conn(); cur = conn.cursor()
    cur.execute('INSERT INTO saved_searches (recruiter_id, name, payload_json) VALUES (?, ?, ?)', (recruiter_id, name, json.dumps(payload)))
    conn.commit(); conn.close()

def list_saved_searches(recruiter_id: str) -> List[Dict[str, Any]]:
    conn = get_conn(); cur = conn.cursor()
    cur.execute('SELECT id, name, payload_json, created_at FROM saved_searches WHERE recruiter_id = ? ORDER BY created_at DESC', (recruiter_id,))
    rows = cur.fetchall(); conn.close()
    out = []
    for r in rows:
        item = dict(r)
        item['payload'] = json.loads(item.pop('payload_json'))
        out.append(item)
    return out

def delete_saved_search(search_id: int):
    conn = get_conn(); cur = conn.cursor()
    cur.execute('DELETE FROM saved_searches WHERE id = ?', (search_id,))
    conn.commit(); conn.close()

# Initialize DB on import
init_db()
