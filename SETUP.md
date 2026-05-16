# Setup and Deployment Guide

This guide provides detailed instructions for setting up **HireIntel AI** in various environments.

## 📋 Prerequisites
- Python 3.10 or higher
- Docker & Docker Compose (optional, for containerized deployment)
- Node.js (optional, if you plan to extend the frontend tooling)

## 🔧 Local Environment Setup

1. **Clone the Project**
   ```bash
   git clone https://github.com/your-username/HireIntel-AI.git
   cd HireIntel-AI
   ```

2. **Virtual Environment** (Recommended)
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Environment Variables**
   Create a `.env` file in the root directory:
   ```env
   PORT=5000
   PRELOAD_MODELS=1
   HIREINTEL_ALLOW_MODEL_DOWNLOAD=1
   ```

5. **Run the App**
   ```bash
   python src/app.py
   ```

## 🐳 Docker Deployment

For a production-consistent environment:
```bash
docker-compose up --build -d
```
The app will pre-load the necessary models on first startup. This may take 2-3 minutes depending on your internet connection.

## 🚀 Cloud Deployment (Render / Railway)

HireIntel AI is designed to be deployment-ready for platforms like Render and Railway.

### Render Deployment
1. Connect your GitHub repository to Render.
2. Select **Web Service**.
3. Choose **Docker** as the Runtime.
4. Add the environment variables (`PORT`, `PRELOAD_MODELS`).
5. Render will automatically build the image using the provided `Dockerfile`.

### Railway Deployment
1. Install the Railway CLI.
2. Run `railway up`.
3. Railway will detect the `Dockerfile` and deploy the service.

## 🧪 Testing
To run the optimization tests:
```bash
python test_optimization.py
```
This verifies that the FAISS service and semantic matchers are working correctly with high-performance metrics.

---
*For support or contributions, please refer to the main README.md.*
