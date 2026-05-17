"""
Lightweight API-based AI inference engine for production deployment.

Eliminates torch, HuggingFace transformers, and heavy memory footprints by
offloading text generation to ultra-fast cloud completions (Groq, OpenRouter, Together AI).
"""

import os
import re
import json
import urllib.request
import urllib.error
import time

from .qa_data import qa_knowledge_base
from ..core.logger import get_logger

logger = get_logger("llm")

# Cache keys / status compatibility
_model_load_error = None


def load_model():
    """No-op for lightweight API inference. Prevents startup delays and downloads."""
    logger.info("Production Mode: API-based cloud inference activated.")
    return None


def unload_model():
    """No-op for lightweight API inference."""
    return None


def parse_chat_prompt(prompt):
    """
    Parse a legacy system/user/assistant template into a standard OpenAI compatible
    messages list to ensure clean cloud formatting.
    """
    messages = []
    
    # Extract system prompt if present
    system_match = re.search(r"<\|system\|>(.*?)(?=<\|user\|>|$)", prompt, re.DOTALL)
    user_match = re.search(r"<\|user\|>(.*?)(?=<\|assistant\|>|$)", prompt, re.DOTALL)
    
    if system_match:
        messages.append({
            "role": "system",
            "content": system_match.group(1).strip()
        })
    else:
        messages.append({
            "role": "system",
            "content": "You are a professional, senior recruiter at a top-tier tech firm running a screening session."
        })
        
    if user_match:
        messages.append({
            "role": "user",
            "content": user_match.group(1).strip()
        })
    else:
        # Fallback if prompt is simple/unstructured
        messages.append({
            "role": "user",
            "content": prompt.strip()
        })
        
    return messages


def _call_api_with_retries(url, headers, payload, timeout=10, max_retries=3):
    """Robust urllib-based HTTP client with linear backoff retries and zero extra dependencies."""
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
    
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                res_body = response.read().decode("utf-8")
                res_json = json.loads(res_body)
                choices = res_json.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content", "").strip()
                    if content:
                        return content
                raise ValueError("API completed but returned an empty choice choice array")
        except Exception as exc:
            last_error = exc
            logger.warning("Cloud completion attempt %d/%d failed: %s", attempt, max_retries, exc)
            if attempt < max_retries:
                time.sleep(1.0 * attempt)
                
    raise RuntimeError(f"All cloud completion API attempts failed: {last_error}")


def _fallback_response(prompt):
    """Context-aware fallback responses to keep the interview flow smooth if APIs go down."""
    prompt_lower = prompt.lower()
    if "score" in prompt_lower or "evaluate" in prompt_lower:
        return "Score: 7/10\nGot it, that is helpful context. I appreciate the explanation. Can you go one step deeper into the trade-offs or constraints you faced in that scenario?"
    return "Understood. That sounds like a solid starting point. What exact metrics or validated outcomes would you point to if assessing the success of that project?"


def generate_text(prompt, max_tokens=256, temperature=0.7, use_qa_data=False):
    """Generate completions using Groq (preferred), OpenRouter, or Together AI."""
    if use_qa_data:
        for question, answer in qa_knowledge_base.items():
            if question.lower() in prompt.lower():
                return answer

    provider = os.getenv("AI_PROVIDER", "groq").lower().strip()
    
    url = ""
    headers = {"Content-Type": "application/json"}
    model_name = ""
    api_key = ""

    if provider == "groq":
        api_key = os.getenv("GROQ_API_KEY", "").strip()
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers["Authorization"] = f"Bearer {api_key}"
        model_name = os.getenv("AI_MODEL", "llama3-8b-8192").strip()
    elif provider == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers["Authorization"] = f"Bearer {api_key}"
        headers["HTTP-Referer"] = "https://hireintel-ai.com"
        headers["X-Title"] = "HireIntel AI"
        model_name = os.getenv("AI_MODEL", "meta-llama/llama-3-8b-instruct:free").strip()
    elif provider == "together":
        api_key = os.getenv("TOGETHER_API_KEY", "").strip()
        url = "https://api.together.xyz/v1/chat/completions"
        headers["Authorization"] = f"Bearer {api_key}"
        model_name = os.getenv("AI_MODEL", "meta-llama/Llama-3-8b-chat-hf").strip()
    else:
        logger.error("Invalid AI_PROVIDER: '%s'. Check env file.", provider)
        return _fallback_response(prompt)

    if not api_key:
        logger.error("API Key for provider '%s' is missing. Falling back.", provider)
        return _fallback_response(prompt)

    messages = parse_chat_prompt(prompt)
    payload = {
        "model": model_name,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature
    }

    try:
        return _call_api_with_retries(url, headers, payload)
    except Exception as exc:
        logger.exception("Cloud inference completely failed: %s", exc)
        return _fallback_response(prompt)


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
