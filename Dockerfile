# Use a lightweight, clean Python base image
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install lightweight dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create necessary application directories
RUN mkdir -p data logs

# Set environment variables
ENV PORT=5000
ENV FLASK_ENV=production

# Expose the application port
EXPOSE 5000

# Set up a healthcheck to ensure service readiness
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Start the lightweight web service
CMD ["python", "-m", "src.app"]
