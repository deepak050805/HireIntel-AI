# Use a lightweight Python base image
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies (e.g., for FAISS and other ML libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create necessary directories
RUN mkdir -p data logs models

# Set environment variables
ENV PORT=5000
ENV FLASK_ENV=production
ENV PRELOAD_MODELS=1
ENV HIREINTEL_ALLOW_MODEL_DOWNLOAD=1

# Expose the application port
EXPOSE 5000

# Set up a healthcheck
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Start the application
CMD ["python", "src/app.py"]
