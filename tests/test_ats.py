import pytest
from src.ml_logic.parser import clean_text
from src.ml_logic.ats_analyzer import analyze_ats


def test_clean_text():
    sample = "\nJohn Doe\n\nSoftware Engineer\n  \n"
    cleaned = clean_text(sample)
    assert "John Doe" in cleaned


def test_analyze_ats_basic():
    resume = """
    John Doe
    Software Engineer

    Experience:
    - Built Python APIs (2 years)
    - Increased performance by 20%

    Skills: Python, SQL, Docker
    """

    result = analyze_ats(resume)
    assert 'overallScore' in result
    assert 'categories' in result
    assert 0 <= result['overallScore'] <= 100
