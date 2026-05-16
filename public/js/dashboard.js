// HireIntel recruiter command center.
// Kept framework-free for today's app, but structured as small render/action modules
// so the dashboard can move cleanly into React/Next.js later.
const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const apiPost = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  return res.json();
};

const LOCAL_KEYS = {
  PREFS: 'hi:prefs',
  PIPELINE: 'hi:pipeline',
  NOTES: 'hi:notes',
  SAVED_SEARCHES: 'hi:saved_searches',
  INTERVIEWS: 'hi:interviews',
  UI_STATE: 'hi:ui_state'
};

const KANBAN_STAGES = [
  { key: 'new', title: 'New' },
  { key: 'reviewed', title: 'Reviewed' },
  { key: 'shortlisted', title: 'Shortlisted' },
  { key: 'interviewing', title: 'Interviewing' },
  { key: 'rejected', title: 'Rejected' },
  { key: 'hired', title: 'Hired' }
];

const stateUI = {
  candidates: [],
  rankMap: {},
  pageSize: 9,
  sortBy: 'semantic',
  sortOrder: 'desc',
  currentQuery: 'developer',
  selectedCandidateId: null,
  boardMode: 'grid',
  prefs: { semantic: 0.7, keyword: 0.3, experience: 0.0 },
  pipeline: {},
  notes: {},
  savedSearches: [],
  activity: [],
  interviews: {},
  undoStack: [],
  dragGhost: null
};

let backendSyncTimer = null;
let hoverPreviewTimer = null;
let hoverPreviewEl = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function pct(value) {
  return Math.max(0, Math.min(100, Math.round(value || 0)));
}

function candidateScore(candidate) {
  return pct((candidate.score || 0) * 100);
}

function candidateAts(candidate) {
  return pct((candidate.meta && candidate.meta.ats) || candidateScore(candidate));
}

function candidateSkills(candidate) {
  return (candidate.meta && candidate.meta.skills) || [];
}

function stageFor(id) {
  return stateUI.pipeline[id] || 'new';
}

function stageTitle(stageKey) {
  const found = KANBAN_STAGES.find((stage) => stage.key === stageKey);
  return found ? found.title : stageKey;
}

function nowIso() {
  return new Date().toISOString();
}

function getFilteredCandidates() {
  return stateUI.candidates.filter((candidate) => {
    const id = candidate.candidate_id;
    if (qs('#filterHighAts')?.checked && candidateAts(candidate) < 75) return false;
    if (qs('#filterSemantic')?.checked && candidateScore(candidate) < 70) return false;
    if (qs('#filterStalled')?.checked && !isCandidateStalled(id)) return false;
    return true;
  });
}

function loadLocalState() {
  try {
    const prefs = localStorage.getItem(LOCAL_KEYS.PREFS);
    const pipeline = localStorage.getItem(LOCAL_KEYS.PIPELINE);
    const notes = localStorage.getItem(LOCAL_KEYS.NOTES);
    const searches = localStorage.getItem(LOCAL_KEYS.SAVED_SEARCHES);
    const interviews = localStorage.getItem(LOCAL_KEYS.INTERVIEWS);
    const ui = localStorage.getItem(LOCAL_KEYS.UI_STATE);
    if (prefs) stateUI.prefs = JSON.parse(prefs);
    if (pipeline) stateUI.pipeline = JSON.parse(pipeline);
    if (notes) stateUI.notes = JSON.parse(notes);
    if (searches) stateUI.savedSearches = JSON.parse(searches);
    if (interviews) stateUI.interviews = JSON.parse(interviews);
    if (ui) {
      const parsed = JSON.parse(ui);
      stateUI.currentQuery = parsed.currentQuery || stateUI.currentQuery;
      stateUI.boardMode = parsed.boardMode || stateUI.boardMode;
    }
  } catch (error) {
    console.warn('loadLocalState failed', error);
  }
}

function saveLocalState() {
  try {
    localStorage.setItem(LOCAL_KEYS.PREFS, JSON.stringify(stateUI.prefs));
    localStorage.setItem(LOCAL_KEYS.PIPELINE, JSON.stringify(stateUI.pipeline));
    localStorage.setItem(LOCAL_KEYS.NOTES, JSON.stringify(stateUI.notes));
    localStorage.setItem(LOCAL_KEYS.SAVED_SEARCHES, JSON.stringify(stateUI.savedSearches));
    localStorage.setItem(LOCAL_KEYS.INTERVIEWS, JSON.stringify(stateUI.interviews));
    localStorage.setItem(LOCAL_KEYS.UI_STATE, JSON.stringify({
      currentQuery: stateUI.currentQuery,
      boardMode: stateUI.boardMode
    }));
  } catch (error) {
    console.warn('saveLocalState failed', error);
  }
}

async function hydrateBackendState() {
  try {
    const [pipelineRes, searchRes, activityRes] = await Promise.all([
      fetch('/api/pipeline/list?recruiterId=default').then((r) => r.json()),
      fetch('/api/saved_search/list?recruiterId=default').then((r) => r.json()),
      fetch('/api/activity/recent?limit=80').then((r) => r.json())
    ]);

    if (pipelineRes && pipelineRes.data) {
      pipelineRes.data.reverse().forEach((item) => {
        stateUI.pipeline[item.candidate_id] = item.stage;
      });
    }

    if (searchRes && searchRes.data && searchRes.data.length) {
      stateUI.savedSearches = searchRes.data.map((item) => ({
        name: item.name,
        payload: item.payload,
        created_at: item.created_at
      }));
    }

    if (activityRes && activityRes.data) {
      stateUI.activity = activityRes.data;
    }

    saveLocalState();
  } catch (error) {
    console.warn('backend state hydration failed', error);
  }
}

async function syncPrefsToBackend() {
  if (backendSyncTimer) clearTimeout(backendSyncTimer);
  backendSyncTimer = setTimeout(async () => {
    try {
      await apiPost('/api/prefs/save', { recruiterId: 'default', prefs: stateUI.prefs });
    } catch (error) {
      console.warn('syncPrefsToBackend failed', error);
    }
  }, 500);
}

function setLoading(isLoading) {
  const candidatesGrid = qs('#candidatesGrid');
  const board = qs('#kanbanBoard');
  if (!candidatesGrid || !board) return;

  if (isLoading) {
    candidatesGrid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
    board.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
    qs('#totalCandidates').textContent = '-';
  }
}

async function loadInitial() {
  setLoading(true);
  try {
    stateUI.pageSize = parseInt(qs('#pageSize')?.value || '9', 10);
    qs('#searchInput').value = stateUI.currentQuery;

    const searchRes = await apiPost('/api/search_candidates', { query: stateUI.currentQuery, k: 50 });
    stateUI.candidates = searchRes && searchRes.data ? searchRes.data : [];

    const ids = stateUI.candidates.map((candidate) => candidate.candidate_id);
    if (ids.length) {
      const rankRes = await apiPost('/api/rank_candidates', {
        jobDescription: stateUI.currentQuery,
        candidateIds: ids,
        k: ids.length
      });
      stateUI.rankMap = {};
      if (rankRes && rankRes.data) {
        rankRes.data.forEach((rank) => {
          stateUI.rankMap[rank.candidate_id] = rank;
        });
      }
    } else {
      stateUI.rankMap = {};
    }

    qs('#totalCandidates').textContent = String(stateUI.candidates.length);
    qs('#topCandidateName').textContent = stateUI.candidates[0]?.candidate_id || '-';
    applySortingAndRender();
  } catch (error) {
    console.error('initial load failed', error);
    qs('#candidatesGrid').innerHTML = '<div class="ats-row">Candidate search failed. Check that the backend server is running and indexed.</div>';
    qs('#kanbanBoard').innerHTML = '<div class="ats-row">Pipeline could not be rendered.</div>';
  }
}

function applySortingAndRender() {
  const sortBy = qs('#sortSelect')?.value || stateUI.sortBy;
  const order = qs('#sortOrder')?.value || stateUI.sortOrder;
  stateUI.sortBy = sortBy;
  stateUI.sortOrder = order;

  const sorted = [...getFilteredCandidates()].sort((a, b) => {
    let va = 0;
    let vb = 0;
    if (sortBy === 'semantic' || sortBy === 'confidence') {
      va = sortBy === 'confidence' ? ((stateUI.rankMap[a.candidate_id]?.confidence || a.score || 0) * 100) : candidateScore(a);
      vb = sortBy === 'confidence' ? ((stateUI.rankMap[b.candidate_id]?.confidence || b.score || 0) * 100) : candidateScore(b);
    } else if (sortBy === 'ats') {
      va = candidateAts(a);
      vb = candidateAts(b);
    } else {
      va = (a.candidate_id || '').toLowerCase();
      vb = (b.candidate_id || '').toLowerCase();
    }
    if (typeof va === 'string') return order === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return order === 'asc' ? va - vb : vb - va;
  });

  renderCandidates(sorted.slice(0, stateUI.pageSize));
  renderKanbanBoard();
  renderCommandCenter();
  renderInsights();
  renderAnalytics();
  renderInterviewBoard();
  renderActivityFeed();
  updatePipelineCounts();
}

function renderCandidates(items) {
  const container = qs('#candidatesGrid');
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<div class="ats-row">No candidates match the current filters.</div>';
    return;
  }

  items.forEach((candidate) => {
    const score = candidateScore(candidate);
    const skills = candidateSkills(candidate);
    const card = document.createElement('article');
    card.className = 'candidate-card';
    card.innerHTML = `
      <div class="card-top">
        <div class="card-person">
          <div class="avatar">${escapeHtml((candidate.candidate_id || '?').slice(0, 2).toUpperCase())}</div>
          <div>
            <div class="candidate-title">${escapeHtml(candidate.candidate_id || 'Unknown')}</div>
            <div class="candidate-subtitle">${escapeHtml(skills.slice(0, 3).join(' / ') || candidate.meta?.role || 'Candidate')}</div>
          </div>
        </div>
        <div class="radial-score ${scoreClass(score)}">${scoreLabel(score)}</div>
      </div>
      <div class="pill-row" style="margin-top:12px">${skills.slice(0, 4).map((skill) => `<span class="skill-pill">${escapeHtml(skill)}</span>`).join('')}</div>
      <div class="suggestion-line">
        <span>${escapeHtml(getSmartSuggestion(candidate).label)}</span>
        <span class="status-pill ${suggestionTone(candidate)}">${escapeHtml(stageTitle(stageFor(candidate.candidate_id)))}</span>
      </div>
      <div class="kanban-quick">
        <button type="button" onclick="openCandidateModal('${escapeHtml(candidate.candidate_id)}')">Profile</button>
        <button type="button" class="primary-action" onclick="moveCandidate('${escapeHtml(candidate.candidate_id)}','${escapeHtml(getSmartSuggestion(candidate).stage)}')">Next action</button>
      </div>
    `;
    addPreviewHandlers(card, candidate);
    container.appendChild(card);
  });
}

function scoreClass(score) {
  if (score >= 70) return 'radial-high';
  if (score >= 45) return 'radial-mid';
  return 'radial-low';
}

function scoreLabel(score) {
  if (score >= 85) return 'Exceptional';
  if (score >= 70) return 'Strong';
  if (score >= 50) return 'Aligned';
  return 'Review';
}

function suggestionTone(candidate) {
  const score = candidateScore(candidate);
  if (score >= 70) return 'green';
  if (score >= 45) return 'amber';
  return 'red';
}

function getSmartSuggestion(candidate) {
  const id = candidate.candidate_id;
  const score = candidateScore(candidate);
  const current = stageFor(id);
  const interview = stateUI.interviews[id];

  if (current === 'new' && score >= 72) return { stage: 'shortlisted', label: 'Prioritize for shortlist' };
  if (current === 'new') return { stage: 'reviewed', label: 'Review profile' };
  if (current === 'reviewed' && score >= 62) return { stage: 'shortlisted', label: 'Move to shortlist' };
  if (current === 'shortlisted') return { stage: 'interviewing', label: interview ? 'Track interview' : 'Schedule interview' };
  if (current === 'interviewing' && interview?.status === 'Complete' && (interview.score || 0) >= 8) return { stage: 'hired', label: 'Prepare offer review' };
  if (current === 'interviewing') return { stage: 'interviewing', label: 'Collect feedback' };
  return { stage: current, label: 'Keep monitoring' };
}

function isCandidateStalled(id) {
  const interview = stateUI.interviews[id];
  const notes = stateUI.notes[id] || [];
  if (stageFor(id) === 'new' && candidateScore(findCandidate(id)) > 70) return true;
  if (stageFor(id) === 'interviewing' && (!interview || interview.status !== 'Complete')) return true;
  return notes.length === 0 && stageFor(id) !== 'new';
}

function findCandidate(id) {
  return stateUI.candidates.find((candidate) => candidate.candidate_id === id) || {};
}

function renderCommandCenter() {
  const container = qs('#commandCenter');
  if (!container) return;

  const total = stateUI.candidates.length || 1;
  const hired = countStage('hired');
  const interviewing = countStage('interviewing');
  const shortlisted = countStage('shortlisted');
  const stalled = stateUI.candidates.filter((candidate) => isCandidateStalled(candidate.candidate_id)).length;
  const topMatches = stateUI.candidates.filter((candidate) => candidateScore(candidate) >= 75).length;
  const velocity = Math.round(((shortlisted + interviewing + hired) / total) * 100);
  const noteCount = Object.values(stateUI.notes).reduce((sum, notes) => sum + notes.length, 0);
  const completedInterviews = Object.values(stateUI.interviews).filter((item) => item.status === 'Complete').length;

  const cards = [
    { label: 'Hiring velocity', value: `${velocity}%`, detail: 'Candidates moving beyond initial review.', tone: velocity >= 45 ? 'good' : '' },
    { label: 'Top semantic matches', value: topMatches, detail: 'Candidates above the priority threshold.', tone: topMatches ? 'good' : '' },
    { label: 'Pipeline bottleneck', value: bottleneckLabel(), detail: 'Highest concentration of active candidates.', tone: stalled ? 'warning' : '' },
    { label: 'Stalled candidates', value: stalled, detail: stalled ? 'Need recruiter action or interview feedback.' : 'No immediate workflow stalls detected.', tone: stalled ? 'warning' : 'good' },
    { label: 'Recruiter productivity', value: noteCount + completedInterviews, detail: 'Notes and completed interview feedback captured.' }
  ];

  container.innerHTML = cards.map((card) => `
    <article class="command-card ${card.tone}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <p>${escapeHtml(card.detail)}</p>
    </article>
  `).join('');
}

function bottleneckLabel() {
  const active = KANBAN_STAGES
    .filter((stage) => !['rejected', 'hired'].includes(stage.key))
    .map((stage) => ({ key: stage.key, count: countStage(stage.key) }))
    .sort((a, b) => b.count - a.count)[0];
  return active && active.count ? stageTitle(active.key) : 'None';
}

function countStage(stage) {
  if (stage === 'new') {
    return stateUI.candidates.filter((candidate) => stageFor(candidate.candidate_id) === 'new').length;
  }
  return Object.values(stateUI.pipeline).filter((value) => value === stage).length;
}

function renderInsights() {
  const skills = new Map();
  stateUI.candidates.forEach((candidate) => {
    candidateSkills(candidate).forEach((skill) => skills.set(skill, (skills.get(skill) || 0) + 1));
  });

  qs('#topSkills').innerHTML = [...skills.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([skill]) => `<span class="skill-pill">${escapeHtml(skill)}</span>`)
    .join('') || '<span class="insight-copy">No skills indexed yet.</span>';

  const top = [...stateUI.candidates].sort((a, b) => candidateScore(b) - candidateScore(a))[0];
  const stalled = stateUI.candidates.filter((candidate) => isCandidateStalled(candidate.candidate_id)).length;
  qs('#semanticInsight').textContent = top
    ? `${top.candidate_id} is the current strongest semantic fit. ${stalled ? `${stalled} candidates need follow-up to prevent pipeline drift.` : 'Pipeline movement is currently healthy.'}`
    : 'Run a search to generate semantic insights.';

  const spark = qs('#confidenceSpark');
  const scores = stateUI.candidates.slice(0, 16).map(candidateScore);
  spark.innerHTML = scores.map((score) => `<div class="spark-bar" title="${score}%" style="height:${Math.max(8, score)}%"></div>`).join('');

  const avgAts = stateUI.candidates.length
    ? Math.round(stateUI.candidates.reduce((sum, candidate) => sum + candidateAts(candidate), 0) / stateUI.candidates.length)
    : 0;
  const avgSemantic = stateUI.candidates.length
    ? Math.round(stateUI.candidates.reduce((sum, candidate) => sum + candidateScore(candidate), 0) / stateUI.candidates.length)
    : 0;
  qs('#avgAts').textContent = String(avgAts);
  qs('#semanticRecall').textContent = `${avgSemantic}%`;
}

function renderKanbanBoard() {
  const board = qs('#kanbanBoard');
  if (!board) return;
  const firstRects = captureRects(board);
  board.innerHTML = '';
  board.className = `kanban board-${stateUI.boardMode}${stateUI.boardMode === 'compact' ? ' compact' : ''}`;

  KANBAN_STAGES.forEach((stage) => {
    const members = stateUI.candidates.filter((candidate) => stageFor(candidate.candidate_id) === stage.key);
    const avg = members.length
      ? Math.round(members.reduce((sum, candidate) => sum + candidateScore(candidate), 0) / members.length)
      : 0;

    const column = document.createElement('section');
    column.className = 'kanban-column';
    column.innerHTML = `
      <h4>
        <span>${escapeHtml(stage.title)}</span>
        <span class="stage-insight">${members.length} candidates / ${avg}% avg</span>
      </h4>
    `;

    const list = document.createElement('div');
    list.className = 'kanban-list';
    list.dataset.stage = stage.key;
    list.addEventListener('dragover', handleDragOver);
    list.addEventListener('dragleave', () => list.classList.remove('over'));
    list.addEventListener('drop', handleDrop);

    members.forEach((candidate) => list.appendChild(createKanbanCard(candidate)));
    column.appendChild(list);
    board.appendChild(column);
  });

  animateFlip(board, firstRects);
}

function createKanbanCard(candidate) {
  const id = candidate.candidate_id;
  const score = candidateScore(candidate);
  const rankInfo = stateUI.rankMap[id];
  const suggestion = getSmartSuggestion(candidate);
  const card = document.createElement('article');
  card.className = 'kanban-card';
  card.draggable = true;
  card.dataset.id = id;
  card.innerHTML = `
    <div class="kanban-meta">
      <div>
        <div class="candidate-title">${escapeHtml(id)}</div>
        <div class="candidate-subtitle">${escapeHtml(candidate.meta?.role || candidate.meta?.summary || candidateSkills(candidate).slice(0, 2).join(' / ') || 'Candidate')}</div>
      </div>
      <div class="score-text">${scoreLabel(score)}</div>
    </div>
    <div class="candidate-subtitle" style="margin-top:7px">Candidate Signal: ${scoreLabel(score)}</div>
    <div class="suggestion-line">
      <span>${escapeHtml(suggestion.label)}</span>
      <span class="status-pill ${suggestionTone(candidate)}">${escapeHtml(anomalyLabel(candidate))}</span>
    </div>
    <div class="kanban-quick">
      <button type="button" onclick="openCandidateModal('${escapeHtml(id)}')">Profile</button>
      <button type="button" class="primary-action" onclick="moveCandidate('${escapeHtml(id)}','${escapeHtml(suggestion.stage)}')">Apply</button>
    </div>
  `;

  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('drag', handleDragMove);
  card.addEventListener('dragend', handleDragEnd);
  addPreviewHandlers(card, candidate);
  return card;
}

function anomalyLabel(candidate) {
  const score = candidateScore(candidate);
  const ats = candidateAts(candidate);
  if (Math.abs(score - ats) >= 30) return 'Score anomaly';
  if (isCandidateStalled(candidate.candidate_id)) return 'Needs action';
  if (score >= 75) return 'Priority';
  return 'Normal';
}

function captureRects(root) {
  const map = new Map();
  qsa('[data-id]', root).forEach((element) => {
    map.set(element.dataset.id, element.getBoundingClientRect());
  });
  return map;
}

function animateFlip(root, firstRects) {
  qsa('[data-id]', root).forEach((element) => {
    const first = firstRects.get(element.dataset.id);
    if (!first) return;
    const last = element.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (!dx && !dy) return;
    element.animate([
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: 'translate(0, 0)' }
    ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}

function handleDragStart(event) {
  const card = event.currentTarget;
  const id = card.dataset.id;
  event.dataTransfer.setData('text/plain', id);
  event.dataTransfer.effectAllowed = 'move';
  card.classList.add('dragging');
  createDragGhost(card, event);
}

function handleDragMove(event) {
  if (!stateUI.dragGhost || !event.clientX) return;
  stateUI.dragGhost.style.left = `${event.clientX + 12}px`;
  stateUI.dragGhost.style.top = `${event.clientY + 12}px`;
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  destroyDragGhost();
  qsa('.kanban-list').forEach((list) => list.classList.remove('over'));
}

function handleDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add('over');
}

async function handleDrop(event) {
  event.preventDefault();
  const list = event.currentTarget;
  list.classList.remove('over');
  const id = event.dataTransfer.getData('text/plain');
  if (!id) return;
  await moveCandidate(id, list.dataset.stage);
}

function createDragGhost(card, event) {
  destroyDragGhost();
  const ghost = card.cloneNode(true);
  ghost.className = 'drag-ghost';
  ghost.style.left = `${event.clientX + 12}px`;
  ghost.style.top = `${event.clientY + 12}px`;
  document.body.appendChild(ghost);
  stateUI.dragGhost = ghost;
}

function destroyDragGhost() {
  if (stateUI.dragGhost) {
    stateUI.dragGhost.remove();
    stateUI.dragGhost = null;
  }
}

async function moveCandidate(id, stage) {
  const previous = stageFor(id);
  if (!id || !stage || previous === stage) return;
  stateUI.pipeline[id] = stage;
  stateUI.undoStack.unshift({ id, previous, next: stage, at: nowIso() });
  stateUI.undoStack = stateUI.undoStack.slice(0, 5);
  qs('#undoMoveBtn').disabled = false;
  saveLocalState();
  applySortingAndRender();

  try {
    addLocalActivity('moved_stage', id, { stage, previous });
    await apiPost('/api/pipeline/update', { candidateId: id, stage, recruiterId: 'default' });
  } catch (error) {
    console.warn('pipeline update failed', error);
  }
}

async function undoLastMove() {
  const item = stateUI.undoStack.shift();
  if (!item) return;
  stateUI.pipeline[item.id] = item.previous;
  qs('#undoMoveBtn').disabled = stateUI.undoStack.length === 0;
  saveLocalState();
  applySortingAndRender();
  try {
    addLocalActivity('moved_stage', item.id, { stage: item.previous, previous: item.next, undo: true });
    await apiPost('/api/pipeline/update', { candidateId: item.id, stage: item.previous, recruiterId: 'default' });
  } catch (error) {
    console.warn('undo pipeline update failed', error);
  }
}

function addPreviewHandlers(element, candidate) {
  element.addEventListener('mouseenter', (event) => {
    hoverPreviewTimer = setTimeout(() => showQuickPreview(candidate, event), 240);
  });
  element.addEventListener('mousemove', positionQuickPreview);
  element.addEventListener('mouseleave', hideQuickPreview);
}

function showQuickPreview(candidate, event) {
  hideQuickPreview();
  const score = candidateScore(candidate);
  hoverPreviewEl = document.createElement('div');
  hoverPreviewEl.className = 'quick-preview';
  hoverPreviewEl.innerHTML = `
    <h5>${escapeHtml(candidate.candidate_id)}</h5>
    <p>${escapeHtml(candidate.meta?.summary || candidate.meta?.role || 'Candidate profile')}</p>
    <div class="pill-row" style="margin-top:8px">${candidateSkills(candidate).slice(0, 5).map((skill) => `<span class="skill-pill">${escapeHtml(skill)}</span>`).join('')}</div>
    <div class="suggestion-line"><span>${scoreLabel(score)} Signal</span></div>
  `;
  document.body.appendChild(hoverPreviewEl);
  positionQuickPreview(event);
}

function positionQuickPreview(event) {
  if (!hoverPreviewEl) return;
  hoverPreviewEl.style.left = `${Math.min(window.innerWidth - 300, event.clientX + 16)}px`;
  hoverPreviewEl.style.top = `${Math.min(window.innerHeight - 180, event.clientY + 16)}px`;
}

function hideQuickPreview() {
  if (hoverPreviewTimer) clearTimeout(hoverPreviewTimer);
  if (hoverPreviewEl) hoverPreviewEl.remove();
  hoverPreviewEl = null;
}

function updatePipelineCounts() {
  qs('#countApplied').textContent = String(countStage('new'));
  qs('#countScreening').textContent = String(countStage('reviewed'));
  qs('#countShortlisted').textContent = String(countStage('shortlisted'));
  qs('#countInterviewing').textContent = String(countStage('interviewing'));
  qs('#countRejected').textContent = String(countStage('rejected'));
  qs('#countOffer').textContent = String(countStage('hired'));
}

function renderAnalytics() {
  renderFunnel();
  renderConversionChart();
  renderScoreDistribution();
  renderTrendChart();
}

function renderFunnel() {
  const funnel = qs('#funnel');
  const total = stateUI.candidates.length || 1;
  funnel.innerHTML = KANBAN_STAGES.map((stage) => {
    const count = countStage(stage.key);
    const percentage = Math.round((count / total) * 100);
    return `
      <div class="funnel-step">
        <span>${escapeHtml(stage.title)}</span>
        <div class="funnel-bar"><div class="funnel-fill" style="width:${percentage}%"></div></div>
        <strong>${percentage}%</strong>
      </div>
    `;
  }).join('');
}

function renderConversionChart() {
  const chart = qs('#conversionChart');
  const total = stateUI.candidates.length || 1;
  const rows = [
    ['Review rate', countStage('reviewed') + countStage('shortlisted') + countStage('interviewing') + countStage('hired')],
    ['Interview rate', countStage('interviewing') + countStage('hired')],
    ['Offer signal', countStage('hired')],
    ['Reject rate', countStage('rejected')]
  ];
  chart.innerHTML = rows.map(([label, count]) => {
    const percentage = Math.round((count / total) * 100);
    return `
      <div class="bar-row">
        <span>${escapeHtml(label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${percentage}%"></div></div>
        <strong>${percentage}%</strong>
      </div>
    `;
  }).join('');
}

function renderScoreDistribution() {
  const chart = qs('#scoreDistribution');
  const buckets = [0, 0, 0, 0, 0];
  stateUI.candidates.forEach((candidate) => {
    const score = candidateScore(candidate);
    const index = Math.min(4, Math.floor(score / 20));
    buckets[index] += 1;
  });
  const max = Math.max(1, ...buckets);
  chart.innerHTML = buckets.map((count, index) => `
    <div class="dist-bar" title="${index * 20}-${index * 20 + 19}: ${count}" style="height:${Math.max(8, (count / max) * 100)}%"></div>
  `).join('');
}

function renderTrendChart() {
  const chart = qs('#trendChart');
  const base = [
    countStage('new'),
    countStage('reviewed'),
    countStage('shortlisted'),
    countStage('interviewing'),
    countStage('hired')
  ];
  const max = Math.max(1, ...base);
  chart.innerHTML = base.map((count) => `<div class="trend-bar" style="height:${Math.max(8, (count / max) * 100)}%"></div>`).join('');
}

function renderInterviewBoard() {
  const board = qs('#interviewBoard');
  const candidates = stateUI.candidates
    .filter((candidate) => ['shortlisted', 'interviewing', 'hired'].includes(stageFor(candidate.candidate_id)))
    .slice(0, 6);

  if (!candidates.length) {
    board.innerHTML = '<div class="ats-row">Shortlist candidates to begin interview planning.</div>';
    return;
  }

  board.innerHTML = '';
  candidates.forEach((candidate) => {
    const id = candidate.candidate_id;
    const interview = stateUI.interviews[id] || {};
    const readiness = interviewReadiness(candidate, interview);
    const card = document.createElement('article');
    card.className = 'interview-card';
    card.innerHTML = `
      <h4>${escapeHtml(id)}</h4>
      <div class="candidate-subtitle">Readiness ${readiness}% / ${escapeHtml(interview.status || 'Not scheduled')}</div>
      <div class="interview-form">
        <input data-field="date" type="datetime-local" value="${escapeHtml(interview.date || '')}" aria-label="Interview date">
        <select data-field="status" aria-label="Interview status">
          ${['Not scheduled', 'Scheduled', 'In progress', 'Complete'].map((status) => `<option ${interview.status === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
        <input data-field="interviewer" value="${escapeHtml(interview.interviewer || '')}" placeholder="Interviewer">
        <textarea data-field="notes" placeholder="Interviewer notes">${escapeHtml(interview.notes || '')}</textarea>
        <select data-field="score" aria-label="Interview score">
          ${Array.from({ length: 11 }, (_, score) => `<option value="${score}" ${(Number(interview.score) || 0) === score ? 'selected' : ''}>Score ${score}/10</option>`).join('')}
        </select>
        <button class="btn-primary-soft" type="button">Save feedback</button>
      </div>
    `;
    card.querySelector('button').addEventListener('click', () => saveInterview(id, card));
    board.appendChild(card);
  });
}

function interviewReadiness(candidate, interview) {
  let score = Math.round((candidateScore(candidate) * 0.55) + (candidateAts(candidate) * 0.25));
  if (candidateSkills(candidate).length >= 4) score += 10;
  if (interview.status === 'Scheduled' || interview.status === 'Complete') score += 10;
  return pct(score);
}

async function saveInterview(id, card) {
  const payload = {};
  qsa('[data-field]', card).forEach((field) => {
    payload[field.dataset.field] = field.value;
  });
  payload.updated_at = nowIso();
  stateUI.interviews[id] = payload;
  if (payload.status === 'Scheduled' && stageFor(id) === 'shortlisted') {
    stateUI.pipeline[id] = 'interviewing';
  }
  saveLocalState();
  applySortingAndRender();
  await emitActivity('interview_updated', id, { status: payload.status, score: payload.score });
}

async function openCandidateModal(id) {
  const candidate = findCandidate(id);
  stateUI.selectedCandidateId = id;
  const score = candidateScore(candidate);
  const skills = candidateSkills(candidate);
  const rank = stateUI.rankMap[id] || {};

  qs('#profileOverlay').classList.remove('hidden');
  qs('#candidateModal').classList.remove('hidden');
  qs('#modalName').textContent = id;
  qs('#modalRole').textContent = candidate.meta?.role || stageTitle(stageFor(id));
  qs('#profileSummary').textContent = candidate.meta?.summary || `Current stage: ${stageTitle(stageFor(id))}. ${getSmartSuggestion(candidate).label}.`;
  qs('#modalRadial').textContent = `${score}%`;
  qs('#modalRadial').className = `radial-score ${scoreClass(score)}`;
  qs('#modalSkills').innerHTML = skills.map((skill) => `<span class="skill-pill">${escapeHtml(skill)}</span>`).join('') || '<span class="insight-copy">No indexed skills.</span>';

  const missing = inferMissingSkills(skills);
  qs('#modalMissing').textContent = missing.length ? missing.join(', ') : 'No obvious gaps against the current query.';
  qs('#modalReco').innerHTML = renderRecommendations(candidate);
  qs('#profileOverlap').innerHTML = renderOverlap(candidate);
  qs('#modalInsights').innerHTML = renderAtsBreakdown(candidate, rank);
  renderSkillHeatmap(qs('#profileSkillHeatmap'), candidate);
  renderModalNotes(id);
  renderProfileInterview(id);
  await renderCandidateTimeline(id);
}

function inferMissingSkills(skills) {
  const queryTerms = stateUI.currentQuery.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const skillText = skills.join(' ').toLowerCase();
  return queryTerms.filter((term) => !skillText.includes(term)).slice(0, 5);
}

function renderRecommendations(candidate) {
  const suggestion = getSmartSuggestion(candidate);
  const anomaly = anomalyLabel(candidate);
  return [
    `Recommended action: ${suggestion.label}.`,
    `Prioritization: ${candidateScore(candidate) >= 75 ? 'High priority semantic match.' : 'Review alongside adjacent candidates.'}`,
    `Workflow signal: ${anomaly}.`
  ].map((item) => `<div class="ats-row">${escapeHtml(item)}</div>`).join('');
}

function renderOverlap(candidate) {
  const skills = candidateSkills(candidate);
  const query = stateUI.currentQuery.toLowerCase();
  return skills.slice(0, 8).map((skill) => {
    const overlap = query.includes(skill.toLowerCase()) ? 92 : Math.max(28, Math.min(86, candidateScore(candidate) - (skill.length % 18)));
    return `<div class="overlap-item"><strong>${escapeHtml(skill)}</strong><span>${overlap}% semantic overlap</span></div>`;
  }).join('') || '<div class="insight-copy">No overlap data available.</div>';
}

function renderAtsBreakdown(candidate, rank) {
  const rows = [
    ['ATS score', `${candidateAts(candidate)}%`],
    ['Semantic score', `${candidateScore(candidate)}%`],
    ['Keyword score', rank.keyword !== undefined ? `${Math.round(rank.keyword)}%` : 'Pending'],
    ['Confidence', rank.confidence !== undefined ? `${Math.round(rank.confidence * 100)}%` : 'Pending'],
    ['Stage', stageTitle(stageFor(candidate.candidate_id))]
  ];
  return rows.map(([label, value]) => `<div class="ats-row"><strong>${escapeHtml(label)}</strong><br>${escapeHtml(value)}</div>`).join('');
}

function renderSkillHeatmap(container, candidate) {
  const skills = candidateSkills(candidate);
  container.innerHTML = skills.slice(0, 10).map((skill) => {
    const value = Math.max(24, Math.min(96, candidateScore(candidate) - (skill.length % 22)));
    return `
      <div class="skill-row">
        <span>${escapeHtml(skill)}</span>
        <div class="skill-bar"><div class="fill" style="width:${value}%"></div></div>
        <strong>${value}%</strong>
      </div>
    `;
  }).join('') || '<div class="insight-copy">No skills available.</div>';
}

async function renderCandidateTimeline(id) {
  const container = qs('#candidateTimeline');
  container.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await fetch(`/api/candidate/timeline?candidateId=${encodeURIComponent(id)}`);
    const json = await res.json();
    const items = json && json.data ? json.data : [];
    container.innerHTML = items.length
      ? items.map((item) => `
        <div class="timeline-event">
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <div class="timeline-type">${escapeHtml(prettyEventLabel(item))}</div>
            <div class="timeline-meta">${escapeHtml(new Date(item.created_at).toLocaleString())}</div>
          </div>
        </div>
      `).join('')
      : '<div class="ats-row">No timeline activity yet.</div>';
  } catch (error) {
    container.innerHTML = '<div class="ats-row">Timeline unavailable.</div>';
  }
}

function renderProfileInterview(id) {
  const container = qs('#profileInterviewFeedback');
  const interview = stateUI.interviews[id];
  if (!interview) {
    container.innerHTML = '<div class="feedback-item">No interview scheduled yet.</div>';
    return;
  }
  container.innerHTML = `
    <div class="feedback-item"><strong>Status</strong><br>${escapeHtml(interview.status || 'Not scheduled')}</div>
    <div class="feedback-item"><strong>Interviewer</strong><br>${escapeHtml(interview.interviewer || 'Unassigned')}</div>
    <div class="feedback-item"><strong>Score</strong><br>${escapeHtml(interview.score || '0')}/10</div>
    <div class="feedback-item"><strong>Notes</strong><br>${escapeHtml(interview.notes || 'No notes captured.')}</div>
  `;
}

function closeCandidateModal() {
  qs('#candidateModal').classList.add('hidden');
  qs('#profileOverlay').classList.add('hidden');
}

async function updateDrawerForSelection(candidateId) {
  const id = candidateId || stateUI.selectedCandidateId || stateUI.candidates[0]?.candidate_id;
  if (!id) return;
  stateUI.selectedCandidateId = id;
  const candidate = findCandidate(id);
  const job = qs('#drawerJob').value || stateUI.currentQuery;
  const skills = candidateSkills(candidate);
  const heat = qs('#skillHeatmap');
  const explain = qs('#skillExplain');
  const reco = qs('#aiReco');
  heat.innerHTML = '<div class="skeleton"></div>';
  explain.innerHTML = '';
  reco.textContent = '';

  try {
    const results = await Promise.all(skills.slice(0, 8).map(async (skill) => {
      const res = await apiPost('/api/semantic_match', { resumeText: skill, jobDescription: job });
      return { skill, data: res && res.data ? res.data : null };
    }));

    heat.innerHTML = results.map((result) => {
      const value = pct(result.data?.semantic || 0);
      return `
        <div class="skill-row">
          <span>${escapeHtml(result.skill)}</span>
          <div class="skill-bar"><div class="fill" style="width:${value}%"></div></div>
          <strong>${value}%</strong>
        </div>
      `;
    }).join('');

    explain.innerHTML = results.map((result) => {
      const value = pct(result.data?.semantic || 0);
      const label = value >= 70 ? 'Strong alignment' : value >= 40 ? 'Partial alignment' : 'Weak alignment';
      return `<div class="explain-item"><strong>${escapeHtml(result.skill)}</strong><br>${label}. Keyword confidence ${Math.round((result.data?.confidence || 0) * 100)}%.</div>`;
    }).join('');

    const rank = stateUI.rankMap[id];
    const weighted = rank
      ? (rank.semantic || 0) * stateUI.prefs.semantic + (rank.keyword || 0) * stateUI.prefs.keyword + (rank.experience || 0) * stateUI.prefs.experience
      : candidateScore(candidate);
    reco.textContent = `${weighted >= 70 ? 'Strong match' : weighted >= 50 ? 'Potential match' : 'Review carefully'} (${weighted.toFixed(1)})`;
  } catch (error) {
    heat.innerHTML = '<div class="ats-row">Semantic analysis unavailable.</div>';
  }
}

function updateWeightDisplays() {
  const semantic = parseFloat(qs('#wSemantic').value);
  const keyword = parseFloat(qs('#wKeyword').value);
  const experience = parseFloat(qs('#wExperience').value);
  stateUI.prefs = { semantic, keyword, experience };
  qs('#wSemanticVal').textContent = semantic.toFixed(2);
  qs('#wKeywordVal').textContent = keyword.toFixed(2);
  qs('#wExperienceVal').textContent = experience.toFixed(2);
  saveLocalState();
  syncPrefsToBackend();
}

async function emitActivity(type, candidateId, payload) {
  addLocalActivity(type, candidateId, payload);
  try {
    await apiPost('/api/activity/emit', { type, candidateId, payload, recruiterId: 'default' });
  } catch (error) {
    console.warn('emitActivity failed', error);
  }
}

function addLocalActivity(type, candidateId, payload) {
  const event = {
    event_type: type,
    candidate_id: candidateId,
    payload: payload || {},
    created_at: nowIso()
  };
  stateUI.activity.unshift(event);
  renderActivityFeed();
}

function renderActivityFeed() {
  const container = qs('#activityFeed');
  const summary = qs('#activitySummary');
  const filter = qs('#activityFilter')?.value || 'all';
  const items = stateUI.activity.filter((activity) => filter === 'all' || activity.event_type === filter).slice(0, 50);
  const grouped = groupActivity(items);

  summary.textContent = `${items.length} visible events. ${countEvent(items, 'moved_stage')} moves, ${countEvent(items, 'note_added')} notes, ${countEvent(items, 'interview_updated')} interview updates.`;
  container.innerHTML = grouped.length
    ? grouped.map((group) => `
      <div class="activity-item">
        <div>${escapeHtml(group.title)}</div>
        <div class="time">${escapeHtml(group.time)}</div>
      </div>
    `).join('')
    : '<div class="activity-item">No activity for this filter.</div>';
}

function groupActivity(items) {
  const groups = [];
  items.forEach((item) => {
    const previous = groups[groups.length - 1];
    const title = prettyEventLabel(item);
    if (previous && previous.type === item.event_type && previous.candidate === item.candidate_id) {
      previous.count += 1;
      previous.title = `${title} (${previous.count})`;
    } else {
      groups.push({
        type: item.event_type,
        candidate: item.candidate_id,
        count: 1,
        title,
        time: new Date(item.created_at).toLocaleString()
      });
    }
  });
  return groups;
}

function countEvent(items, type) {
  return items.filter((item) => item.event_type === type).length;
}

function prettyEventLabel(activity) {
  const type = activity.event_type || activity.type || activity.eventType;
  const cid = activity.candidate_id || '';
  const payload = activity.payload || {};
  if (type === 'moved_stage') return `${cid ? `${cid}: ` : ''}${payload.undo ? 'Reverted to' : 'Moved to'} ${stageTitle(payload.stage)}`;
  if (type === 'note_added') return `${cid ? `${cid}: ` : ''}Recruiter note added`;
  if (type === 'saved_search') return `Saved search: ${payload.name || ''}`;
  if (type === 'interview_updated') return `${cid ? `${cid}: ` : ''}Interview ${payload.status || 'updated'}`;
  if (type === 'rank_update') return `${cid ? `${cid}: ` : ''}Ranking updated`;
  return type || 'Activity';
}

function renderModalNotes(candidate) {
  const container = qs('#modalNotes');
  const notes = stateUI.notes[candidate] || [];
  container.innerHTML = notes.length
    ? notes.slice(0, 20).map((note) => `<div class="note-item">${escapeHtml(note.text)}<div class="timeline-meta">${escapeHtml(new Date(note.created_at).toLocaleString())}</div></div>`).join('')
    : '<div class="note-item">No recruiter notes yet.</div>';
}

async function saveNote() {
  const candidate = stateUI.selectedCandidateId;
  const input = qs('#modalNoteInput');
  const text = input.value.trim();
  if (!candidate || !text) return;
  stateUI.notes[candidate] = stateUI.notes[candidate] || [];
  stateUI.notes[candidate].unshift({ text, created_at: nowIso() });
  input.value = '';
  saveLocalState();
  renderModalNotes(candidate);
  renderCommandCenter();
  addLocalActivity('note_added', candidate, { note: text });
  try {
    await apiPost('/api/candidate/note', { candidateId: candidate, note: text, recruiterId: 'default' });
  } catch (error) {
    console.warn('note save backend failed', error);
  }
}

function renderSavedSearches() {
  const select = qs('#savedSearches');
  select.innerHTML = '<option value="">Saved searches</option>';
  stateUI.savedSearches.forEach((search) => {
    const option = document.createElement('option');
    option.value = search.name;
    option.textContent = search.name;
    select.appendChild(option);
  });
}

async function saveSearch() {
  const name = prompt('Save search as:');
  if (!name) return;
  const payload = {
    query: stateUI.currentQuery,
    prefs: stateUI.prefs,
    filters: {
      highAts: qs('#filterHighAts').checked,
      highSemantic: qs('#filterSemantic').checked,
      stalled: qs('#filterStalled').checked
    }
  };
  stateUI.savedSearches.unshift({ name, payload, created_at: nowIso() });
  saveLocalState();
  renderSavedSearches();
  addLocalActivity('saved_search', null, { name });
  try {
    await apiPost('/api/saved_search/save', { recruiterId: 'default', name, payload });
  } catch (error) {
    console.warn('save search backend failed', error);
  }
}

function restoreSavedSearch() {
  const name = qs('#savedSearches').value;
  if (!name) return;
  const search = stateUI.savedSearches.find((item) => item.name === name);
  if (!search) return;
  stateUI.currentQuery = search.payload.query || stateUI.currentQuery;
  stateUI.prefs = search.payload.prefs || stateUI.prefs;
  qs('#searchInput').value = stateUI.currentQuery;
  qs('#filterHighAts').checked = Boolean(search.payload.filters?.highAts);
  qs('#filterSemantic').checked = Boolean(search.payload.filters?.highSemantic);
  qs('#filterStalled').checked = Boolean(search.payload.filters?.stalled);
  qs('#wSemantic').value = stateUI.prefs.semantic;
  qs('#wKeyword').value = stateUI.prefs.keyword;
  qs('#wExperience').value = stateUI.prefs.experience;
  updateWeightDisplays();
  loadInitial();
}

function setBoardMode(mode) {
  stateUI.boardMode = mode;
  qsa('.segmented button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  saveLocalState();
  renderKanbanBoard();
}

function bindEvents() {
  qs('#searchBtn').addEventListener('click', () => {
    stateUI.currentQuery = qs('#searchInput').value.trim() || 'developer';
    saveLocalState();
    loadInitial();
  });
  qs('#searchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') qs('#searchBtn').click();
  });
  qs('#refreshBtn').addEventListener('click', loadInitial);
  qs('#saveSearchBtn').addEventListener('click', saveSearch);
  qs('#savedSearches').addEventListener('change', restoreSavedSearch);
  qs('#sortSelect').addEventListener('change', applySortingAndRender);
  qs('#sortOrder').addEventListener('change', applySortingAndRender);
  qs('#pageSize').addEventListener('change', (event) => {
    stateUI.pageSize = parseInt(event.target.value || '9', 10);
    applySortingAndRender();
  });
  ['#filterHighAts', '#filterSemantic', '#filterStalled', '#activityFilter'].forEach((selector) => {
    qs(selector).addEventListener('change', applySortingAndRender);
  });
  qs('#undoMoveBtn').addEventListener('click', undoLastMove);
  qsa('.segmented button').forEach((button) => button.addEventListener('click', () => setBoardMode(button.dataset.mode)));
  qs('#modalClose').addEventListener('click', closeCandidateModal);
  qs('#profileOverlay').addEventListener('click', closeCandidateModal);
  qs('#modalSaveNote').addEventListener('click', saveNote);
  qs('#openInsightsBtn').addEventListener('click', () => openSemanticDrawer());
  qs('#openDrawerFromModal').addEventListener('click', () => openSemanticDrawer(stateUI.selectedCandidateId));
  qs('#drawerClose').addEventListener('click', () => qs('#semanticDrawer').classList.add('hidden'));
  qsa('.profile-tabs button').forEach((button) => {
    button.addEventListener('click', () => {
      qsa('.profile-tabs button').forEach((item) => item.classList.remove('active'));
      qsa('.profile-pane').forEach((pane) => pane.classList.remove('active'));
      button.classList.add('active');
      qs(`[data-profile-pane="${button.dataset.profileTab}"]`).classList.add('active');
    });
  });
  ['#wSemantic', '#wKeyword', '#wExperience'].forEach((selector) => {
    qs(selector).addEventListener('input', () => {
      updateWeightDisplays();
      updateDrawerForSelection();
    });
  });
}

function openSemanticDrawer(candidateId) {
  qs('#semanticDrawer').classList.remove('hidden');
  qs('#drawerJob').value = qs('#searchInput').value || stateUI.currentQuery;
  updateDrawerForSelection(candidateId);
}

async function init() {
  loadLocalState();
  bindEvents();
  renderSavedSearches();
  qs('#wSemantic').value = stateUI.prefs.semantic;
  qs('#wKeyword').value = stateUI.prefs.keyword;
  qs('#wExperience').value = stateUI.prefs.experience;
  updateWeightDisplays();
  setBoardMode(stateUI.boardMode);
  await hydrateBackendState();
  renderSavedSearches();
  await loadInitial();
}

window.openCandidateModal = openCandidateModal;
window.moveCandidate = moveCandidate;
window.addToPipeline = moveCandidate;

init();
