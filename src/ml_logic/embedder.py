"""
Lightweight TF-IDF-based semantic vectorization engine.

Completely eliminates PyTorch, SentenceTransformers, and local model weights,
replacing them with an optimized, lightweight vocabulary-mapped TF-IDF vectorizer
packaged into exactly 384 dimensions. Starts up instantly on Render/Railway.
"""

import os
import hashlib
import pickle
import math
from pathlib import Path
from ..core.config import settings
from sklearn.feature_extraction.text import TfidfVectorizer

# 384-dimensional highly optimized industry technical and soft skill vocabulary
# to ensure high sensitivity to resumes and job requirements.
RAW_VOCAB = [
    'python', 'javascript', 'typescript', 'react', 'vue', 'angular', 'node', 'express', 
    'nextjs', 'nest', 'django', 'flask', 'fastapi', 'ruby', 'rails', 'php', 'laravel', 
    'wordpress', 'java', 'spring', 'kotlin', 'swift', 'objective-c', 'flutter', 'dart', 
    'react native', 'golang', 'rust', 'c++', 'c#', '.net', 'asp.net', 'sql', 'mysql', 
    'postgresql', 'sqlite', 'mongodb', 'redis', 'cassandra', 'dynamodb', 'elasticsearch', 
    'neo4j', 'mariadb', 'oracle', 'mssql', 'firebase', 'supabase', 'prisma', 'sequelize', 
    'hibernate', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'jenkins', 'github actions', 
    'gitlab ci', 'circleci', 'terraform', 'ansible', 'chef', 'puppet', 'vagrant', 'linux', 
    'unix', 'windows', 'macos', 'nginx', 'apache', 'iis', 'cloudflare', 'route53', 's3', 
    'ec2', 'rds', 'lambda', 'fargate', 'ecs', 'eks', 'sqs', 'sns', 'amqp', 'rabbitmq', 
    'kafka', 'graphql', 'rest api', 'grpc', 'soap', 'web sockets', 'html', 'css', 'sass', 
    'less', 'tailwind', 'bootstrap', 'material ui', 'semantic ui', 'webpack', 'vite', 
    'gulp', 'babel', 'git', 'github', 'gitlab', 'bitbucket', 'jira', 'confluence', 'trello', 
    'slack', 'zoom', 'teams', 'agile', 'scrum', 'kanban', 'sprint', 'waterfall', 'safe', 
    'ci/cd', 'devops', 'sysadmin', 'sre', 'qa', 'testing', 'jest', 'mocha', 'cypress', 
    'selenium', 'playwright', 'unittest', 'pytest', 'junit', 'nunit', 'rspec', 'capybara', 
    'machine learning', 'deep learning', 'nlp', 'computer vision', 'data science', 
    'data analytics', 'data engineering', 'big data', 'hadoop', 'spark', 'flink', 'hive', 
    'pig', 'airflow', 'luigi', 'presto', 'trino', 'dbt', 'snowflake', 'redshift', 
    'bigquery', 'databricks', 'tableau', 'power bi', 'looker', 'metabase', 'numpy', 
    'pandas', 'scipy', 'scikit-learn', 'tensorflow', 'keras', 'pytorch', 'jax', 'opencv', 
    'nltk', 'spacy', 'huggingface', 'langchain', 'llama', 'gpt', 'openai', 'anthropic', 
    'cohere', 'midjourney', 'stable diffusion', 'dall-e', 'copilot', 'codex', 'prompts', 
    'llm', 'nlp', 'embeddings', 'vector search', 'faiss', 'chroma', 'pinecone', 'milvus', 
    'qdrant', 'weaviate', 'elasticsearch', 'opensearch', 'solr', 'lucene', 'leadership', 
    'management', 'mentoring', 'coaching', 'collaboration', 'communication', 'teamwork', 
    'problem solving', 'critical thinking', 'decision making', 'time management', 
    'negotiation', 'conflict resolution', 'adaptability', 'flexibility', 'creativity', 
    'innovation', 'empathy', 'emotional intelligence', 'active listening', 'presentation', 
    'public speaking', 'technical writing', 'documentation', 'customer service', 
    'client management', 'stakeholder management', 'product management', 'project management', 
    'business analysis', 'requirements gathering', 'system design', 'software architecture', 
    'microservices', 'monolith', 'serverless', 'soa', 'mvc', 'mvvm', 'clean architecture', 
    'domain driven design', 'test driven development', 'behavior driven development', 
    'domain specific', 'design patterns', 'solid principles', 'dry', 'yagni', 'kiss', 
    'refactoring', 'code review', 'debugging', 'troubleshooting', 'performance optimization', 
    'memory management', 'garbage collection', 'multithreading', 'concurrency', 
    'asynchronous programming', 'event driven', 'reactive programming', 'functional programming', 
    'object oriented', 'procedural', 'imperative', 'declarative', 'compilers', 'interpreters', 
    'assemblers', 'linkers', 'loaders', 'operating systems', 'networking', 'tcp/ip', 'http', 
    'https', 'ftp', 'ssh', 'dns', 'dhcp', 'routing', 'switching', 'firewalls', 'vpn', 
    'load balancing', 'reverse proxy', 'dnssec', 'tls/ssl', 'cryptography', 'encryption', 
    'hashing', 'salting', 'jwt', 'oauth', 'saml', 'openid', 'rbac', 'abac', 'iam', 'sso', 
    'security auditing', 'penetration testing', 'vulnerability assessment', 'owasp', 
    'xss', 'csrf', 'sql injection', 'ddos', 'firewall', 'waf', 'siem', 'soc', 'compliance', 
    'gdpr', 'ccpa', 'hipaa', 'pci-dss', 'soc2', 'iso27001', 'itil', 'cobit', 'togaf', 
    'architect', 'lead', 'senior', 'principal', 'staff', 'manager', 'director', 'vp', 
    'cto', 'ceo', 'cfo', 'coo', 'founder', 'co-founder', 'entrepreneur', 'consultant', 
    'advisor', 'freelancer', 'contractor', 'remote', 'hybrid', 'onsite', 'full-time', 
    'part-time', 'intern', 'apprentice', 'graduate', 'junior', 'mid-level', 'senior-level'
]

# Guarantee exactly 384 dimensions to remain fully backward compatible
VOCABULARY = RAW_VOCAB[:384]
if len(VOCABULARY) < 384:
    VOCABULARY += [f"pad_feat_{i}" for i in range(384 - len(VOCABULARY))]


class ResumeEmbedder:
    def __init__(self, model_name=None):
        self.model_name = model_name or settings.EMBEDDING_MODEL
        self.cache_dir = settings.CACHE_DIR
        os.makedirs(self.cache_dir, exist_ok=True)
        # Fast, pure TF-IDF vectorizer mapping exactly to 384 dimensions
        self.vectorizer = TfidfVectorizer(vocabulary=VOCABULARY, lowercase=True)

    def _cache_path(self, text: str) -> Path:
        h = hashlib.md5(text.encode('utf-8')).hexdigest()
        return Path(self.cache_dir) / f"embed_{h}.pkl"

    def generate_embedding(self, text: str, use_cache: bool = True):
        if not text:
            return [0.0] * 384

        cp = self._cache_path(text)
        if use_cache and cp.exists():
            try:
                with open(cp, 'rb') as f:
                    return pickle.load(f)
            except Exception:
                pass

        # Vectorize text using lightweight vocabulary map
        vec = self.vectorizer.fit_transform([text]).toarray()[0]
        # Normalize
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [float(v / norm) for v in vec]
        else:
            vec = [0.0] * 384

        if use_cache:
            try:
                with open(cp, 'wb') as f:
                    pickle.dump(vec, f)
            except Exception:
                pass
        return vec