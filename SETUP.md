# Setup and Deployment Guide

This guide details instructions for launching **HireIntel AI** using lightweight cloud AI completions for production-ready setups.

---

## 📋 Prerequisites
* Python 3.10 or higher
* Docker & Docker Compose (optional, for containerized environments)

---

## 🔧 Local Environment Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/deepak050805/HireIntel-AI.git
   cd HireIntel-AI
   ```

2. **Initialize Virtual Environment**
   ```bash
   python -m venv venv
   # On Windows:
   .\venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```

3. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure Environment Variables**
   Create a `.env` file in the root directory by copying the production template:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in your keys:
   ```env
   # Completion Provider: groq, openrouter, or together
   AI_PROVIDER=groq
   GROQ_API_KEY=gsk_your_groq_api_key_here
   
   # Server Port
   PORT=5000
   ```

5. **Start Application**
   ```bash
   python src/app.py
   ```
   Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## 🐳 Docker Deployment

The Docker setup builds a completely optimized environment, pre-caching the semantic embedding models during the build stage.

```bash
# Start containerized services in background
docker-compose up --build -d
```
Your containerized SaaS is now running on port `5000` with **instant cold-starts** since zero models are downloaded at runtime!

---

## 🚀 Cloud Deployment (Render / Railway)

Because HireIntel AI offloads heavy text completions to cloud APIs and pre-caches the embedding layers, it is fully optimized to run on free or cheap starter tiers (e.g. Render Starter Plan with 512MB RAM) without hitting memory ceilings.

### Render Web Service
1. Connect your GitHub repository to **Render**.
2. Create a new **Web Service**.
3. Choose **Docker** as the Runtime. (Render will automatically detect the optimized `Dockerfile` and build it).
4. Add the following **Environment Variables** in the Render Dashboard:
   * `PORT` = `5000`
   * `AI_PROVIDER` = `groq` (or your preferred provider)
   * `GROQ_API_KEY` = `your_actual_groq_api_key_here`
5. Click **Deploy**. Startup takes under 10 seconds!

### Railway Deployment
1. Connect your repo or run `railway up` using the Railway CLI.
2. In the Railway dashboard, navigate to **Variables** and add:
   * `AI_PROVIDER` = `groq`
   * `GROQ_API_KEY` = `your_actual_groq_api_key_here`
3. Railway automatically compiles the Docker configuration and launches the service.

---

## 🧪 Validating Local Setup
To run local service tests (validation for FAISS indexing and semantic similarity metrics):
```bash
python test_optimization.py
```
This confirms that the local vector matching runs with high accuracy.
