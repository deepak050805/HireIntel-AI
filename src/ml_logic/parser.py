import PyPDF2
import docx
import io
import hashlib
import pickle
from pathlib import Path
from ..core.config import settings
from ..core.logger import get_logger

logger = get_logger('parser')

# Simple in-memory cache for parsed resumes
_parse_cache = {}


def _cache_file_path(file_hash: str) -> Path:
    return Path(settings.CACHE_DIR) / f"parse_{file_hash}.pkl"


def extract_text_from_pdf(file_bytes):
    """Extract text from PDF with error handling"""
    try:
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
        text = ""
        for page in pdf_reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        return text.strip()
    except Exception as e:
        logger.exception("Error extracting PDF: %s", e)
        return ""

def extract_text_from_docx(file_bytes):
    """Extract text from DOCX with error handling"""
    try:
        doc = docx.Document(io.BytesIO(file_bytes))
        text = "\n".join([paragraph.text for paragraph in doc.paragraphs if paragraph.text.strip()])
        return text.strip()
    except Exception as e:
        logger.exception("Error extracting DOCX: %s", e)
        return ""

def parse_resume(file_bytes, filename):
    """Parse resume with caching to avoid re-parsing same files"""
    
    # Create cache key from file hash
    file_hash = hashlib.md5(file_bytes).hexdigest()

    # Return cached result if available (memory)
    if file_hash in _parse_cache:
        logger.debug("Using in-memory cached parse for %s", filename)
        return _parse_cache[file_hash]

    # Return disk cache if available
    cache_fp = _cache_file_path(file_hash)
    if cache_fp.exists():
        try:
            with open(cache_fp, 'rb') as f:
                val = pickle.load(f)
            _parse_cache[file_hash] = val
            logger.debug("Using disk cached parse for %s", filename)
            return val
        except Exception:
            pass
    
    # Parse based on file type
    if filename.endswith('.pdf'):
        text = extract_text_from_pdf(file_bytes)
    elif filename.endswith('.docx') or filename.endswith('.doc'):
        text = extract_text_from_docx(file_bytes)
    else:
        raise ValueError("Unsupported file format. Please upload PDF or DOCX.")
    
    # Clean and cache
    cleaned = clean_text(text)
    _parse_cache[file_hash] = cleaned
    try:
        with open(cache_fp, 'wb') as f:
            pickle.dump(cleaned, f)
    except Exception:
        logger.debug("Failed to write parse cache for %s", filename)

    # Limit cache size to prevent memory issues
    if len(_parse_cache) > 200:
        oldest_key = next(iter(_parse_cache))
        del _parse_cache[oldest_key]

    return cleaned

def clean_text(text):
    """Remove extra whitespaces and empty lines"""
    if not text:
        return ""

    lines = [line.strip() for line in text.split('\n') if line.strip()]
    return "\n".join(lines)

def clear_cache():
    """Clear parse cache if needed"""
    global _parse_cache
    _parse_cache.clear()
