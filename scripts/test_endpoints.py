import requests
import time

base = 'http://127.0.0.1:5000'

def p(name, r):
    print(name, r.status_code, r.json())

time.sleep(1)
print('Health ->')
p('health', requests.get(base + '/health'))

print('\nSearch (before indexing) ->')
r = requests.post(base + '/api/search_candidates', json={'query': 'Python backend', 'k': 5})
p('search', r)

print('\nSemantic match ->')
r = requests.post(base + '/api/semantic_match', json={'resumeText': 'Experienced Python Flask dev', 'jobDescription': 'Backend Python developer with Flask and SQL'})
p('semantic_match', r)

print('\nATS analyze ->')
r = requests.post(base + '/api/analyze/ats', json={'resumeText': 'Experienced Python backend developer with Flask and SQL'})
p('ats', r)

print('\nRank candidates ->')
r = requests.post(base + '/api/rank_candidates', json={'jobDescription': 'Backend Python developer with Flask and SQL', 'k': 5})
p('rank', r)
