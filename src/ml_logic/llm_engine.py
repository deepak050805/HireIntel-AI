"""
Local LLM engine using Qwen2.5-0.5B-Instruct.

The heavyweight transformer imports are intentionally lazy. This keeps API
routes importable even when the local model stack has a dependency mismatch,
and lets callers decide how to degrade gracefully.
"""

import os
import re

from .qa_data import qa_knowledge_base
from ..core.logger import get_logger

logger = get_logger("llm")

MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"
MODEL_CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
ALLOW_MODEL_DOWNLOAD = os.getenv("HIREINTEL_ALLOW_MODEL_DOWNLOAD", "0") == "1"
_model_load_error = None

tokenizer = None
model = None
pipe = None


def ensure_models_dir():
    os.makedirs(MODEL_CACHE_DIR, exist_ok=True)


def load_model():
    """Load the local text-generation model once and cache it."""
    global tokenizer, model, pipe, _model_load_error

    if pipe is not None:
        return pipe
    if _model_load_error is not None:
        raise RuntimeError(f"Local interview model unavailable: {_model_load_error}") from _model_load_error

    ensure_models_dir()
    logger.info("Loading local interview model: %s", MODEL_ID)

    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline

        tokenizer = AutoTokenizer.from_pretrained(
            MODEL_ID,
            cache_dir=MODEL_CACHE_DIR,
            trust_remote_code=True,
            local_files_only=not ALLOW_MODEL_DOWNLOAD,
        )

        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            cache_dir=MODEL_CACHE_DIR,
            torch_dtype="auto",
            low_cpu_mem_usage=True,
            trust_remote_code=True,
            device_map="auto",
            local_files_only=not ALLOW_MODEL_DOWNLOAD,
        )

        pipe = pipeline(
            "text-generation",
            model=model,
            tokenizer=tokenizer,
            device_map="auto",
        )

        logger.info("Local interview model loaded successfully")
        return pipe
    except Exception as exc:
        _model_load_error = exc
        logger.exception(
            "Local interview model failed to load. Verify transformers, "
            "huggingface_hub, accelerate, and cached model files: %s",
            exc,
        )
        raise


def generate_text(prompt, max_tokens=256, temperature=0.7, use_qa_data=False):
    """Generate text using the local model."""
    if use_qa_data:
        for question, answer in qa_knowledge_base.items():
            if question.lower() in prompt.lower():
                return answer

    active_pipe = load_model()
    outputs = active_pipe(
        prompt,
        max_new_tokens=max_tokens,
        do_sample=True,
        temperature=temperature,
        top_k=50,
        top_p=0.95,
        pad_token_id=tokenizer.eos_token_id,
        eos_token_id=tokenizer.eos_token_id,
    )
    return outputs[0]["generated_text"]


def extract_questions_from_text(text):
    """Extract questions from generated text."""
    questions = []
    for line in text.split("\n"):
        clean_line = re.sub(r"^\d+[\.\)]\s*", "", line.strip())
        clean_line = re.sub(r"^(Question|Q)[\:\s]*", "", clean_line, flags=re.IGNORECASE)
        if clean_line and len(clean_line) > 10 and "?" in clean_line:
            questions.append(clean_line)
    return questions


def extract_score_from_text(text):
    """Extract score from evaluation text."""
    match = re.search(r"(\d+)\s*/\s*10", text)
    if match:
        return max(1, min(10, int(match.group(1))))

    match = re.search(r"\b([1-9]|10)\b", text)
    if match:
        return max(1, min(10, int(match.group(1))))

    return 7


def unload_model():
    """Unload model to free memory."""
    global tokenizer, model, pipe

    if model is not None:
        del model
        del tokenizer
        del pipe
        tokenizer = None
        model = None
        pipe = None

        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

        logger.info("Model unloaded, memory freed")
