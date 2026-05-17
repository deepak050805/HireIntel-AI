# Use a lightweight Python base image
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies (e.g., for FAISS, network checks, and other ML libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-cache the lightweight embedding model during the build stage
# This guarantees instant startup times and zero runtime model downloads on Render/Railway
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Copy the rest of the application
COPY . .

# Create necessary directories
RUN mkdir -p data logs

# Set environment variables
ENV PORT=5000
ENV FLASK_ENV=production

# Expose the application port
EXPOSE 5000

# Set up a healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Start the application
CMD ["python", "-m", "src.app"]
