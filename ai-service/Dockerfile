# Development image for the AI service. The first request that needs speech-to-text downloads the Whisper model.
FROM python:3.12.3-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt requirements-speech.txt requirements-vision.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Optional features: a failure here must not stop the image from building; /capabilities reports what is missing.
RUN pip install --no-cache-dir -r requirements-speech.txt || echo 'speech extras not installed'
RUN pip install --no-cache-dir -r requirements-vision.txt || echo 'vision extras not installed'
COPY app ./app
# ~/.cache is created and owned by appuser so the named volume that stores the Whisper model is writable.
RUN useradd -m appuser && mkdir -p /home/appuser/.cache && chown -R appuser /app /home/appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
