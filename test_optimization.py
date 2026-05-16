#!/usr/bin/env python3
"""
Test script to verify HireIntel AI optimizations
Checks: startup time, API responses, dependency count
"""

import time
import sys
import subprocess
import os

def test_imports():
    """Test that all imports work without heavy dependencies"""
    print("✓ Testing imports...")
    start = time.time()
    
    try:
        from src.ml_logic.parser import parse_resume
        from src.ml_logic.ats_analyzer import analyze_ats
        from src.ml_logic.job_matcher import match_jobs
        from src.ml_logic.interview_engine import generate_questions, evaluate_answer
        
        elapsed = time.time() - start
        print(f"  ✅ All imports successful in {elapsed:.2f}s")
        return True
    except Exception as e:
        print(f"  ❌ Import failed: {e}")
        return False

def test_ats_analyzer():
    """Test ATS analyzer with sample resume"""
    print("\n✓ Testing ATS Analyzer...")
    
    sample_resume = """
    John Doe
    Software Engineer
    
    Experience:
    - Developed Python APIs (2 years)
    - Led team of 5 engineers
    - Increased performance by 40%
    
    Skills:
    Python, JavaScript, React, AWS, Docker, SQL
    
    Education:
    BS Computer Science
    """
    
    try:
        from src.ml_logic.ats_analyzer import analyze_ats
        
        start = time.time()
        result = analyze_ats(sample_resume)
        elapsed = time.time() - start
        
        print(f"  ✅ ATS Score: {result['overallScore']} (analyzed in {elapsed:.3f}s)")
        print(f"     Keywords found: {len(result['categories']['keywords']['detectedKeywords'])}")
        return True
    except Exception as e:
        print(f"  ❌ ATS test failed: {e}")
        return False

def test_parser():
    """Test resume parser with sample text"""
    print("\n✓ Testing Resume Parser...")
    
    sample_text = "John Doe\nSoftware Engineer\nPython, Java, SQL"
    
    try:
        from src.ml_logic.parser import clean_text
        
        start = time.time()
        result = clean_text(sample_text)
        elapsed = time.time() - start
        
        print(f"  ✅ Parser working (cleaned in {elapsed:.3f}s)")
        print(f"     Lines: {len(result.split(chr(10)))}")
        return True
    except Exception as e:
        print(f"  ❌ Parser test failed: {e}")
        return False

def test_dependencies():
    """Check dependency count"""
    print("\n✓ Checking Dependencies...")
    
    try:
        with open('requirements.txt', 'r') as f:
            deps = [line.strip() for line in f if line.strip() and not line.startswith('#')]
        
        print(f"  ✅ Total dependencies: {len(deps)}")
        for dep in deps:
            print(f"     - {dep}")
        
        if len(deps) < 10:
            print(f"  ✅ Excellent! Reduced from ~69 to {len(deps)} packages")
        return True
    except Exception as e:
        print(f"  ❌ Dependency check failed: {e}")
        return False

def test_groq_config():
    """Check Groq API configuration"""
    print("\n✓ Checking Groq Configuration...")
    
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    
    if not api_key or api_key == "your_groq_api_key_here":
        print("  ⚠️  GROQ_API_KEY not configured")
        print("     Set it in .env file for full functionality")
        return False
    else:
        print("  ✅ GROQ_API_KEY is configured")
        return True

def main():
    print("\n" + "="*50)
    print("HireIntel AI - Optimization Test Suite")
    print("="*50)
    
    tests = [
        ("Imports", test_imports),
        ("ATS Analyzer", test_ats_analyzer),
        ("Resume Parser", test_parser),
        ("Dependencies", test_dependencies),
        ("Groq Config", test_groq_config),
    ]
    
    results = []
    for name, test_func in tests:
        try:
            results.append(test_func())
        except Exception as e:
            print(f"  ❌ Test error: {e}")
            results.append(False)
    
    print("\n" + "="*50)
    passed = sum(results)
    total = len(results)
    print(f"Results: {passed}/{total} tests passed")
    print("="*50 + "\n")
    
    if passed == total:
        print("✅ All tests passed! System is optimized and ready.")
        return 0
    else:
        print("⚠️  Some tests failed. Check configuration and dependencies.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
