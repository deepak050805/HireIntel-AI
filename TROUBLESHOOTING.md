# Troubleshooting Guide - HireIntel AI

## Issue: "Unable to evaluate at this moment" Error

### Root Cause
The Groq API key is not configured or is invalid. The application falls back to a default error message.

### Solution

#### Step 1: Get a Free Groq API Key
1. Go to https://console.groq.com
2. Click "Sign Up" (free account, no credit card needed)
3. Go to "API Keys" section
4. Click "Create New API Key"
5. Copy the key (starts with `gsk_`)

#### Step 2: Add API Key to .env File
1. Open `.env` file in your project folder
2. Replace `your_groq_api_key_here` with your actual key:
   ```
   GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxx
   PORT=5000
   ```
3. **Important**: Do NOT add quotes around the key
4. Save the file

#### Step 3: Restart the Server
1. Stop the running server (Ctrl+C)
2. Run `python app.py` again
3. You should see: `✅ Using Groq API for instant AI inference`

---

## Common Issues & Fixes

### Issue: "GROQ_API_KEY not set" Warning
**Symptom**: Warning appears when starting the server

**Fix**:
- Ensure `.env` file exists in the project root
- Check that `GROQ_API_KEY=` line is present
- Verify the key is not wrapped in quotes
- Restart the server

### Issue: "Connection refused" or "Network error"
**Symptom**: API calls fail with network errors

**Fixes**:
1. Check internet connection
2. Verify Groq API status: https://status.groq.com
3. Check if firewall is blocking outbound connections
4. Try a different network (mobile hotspot)

### Issue: "Invalid API key" Error
**Symptom**: 401 Unauthorized error

**Fixes**:
1. Double-check the API key in `.env` file
2. Generate a new API key from https://console.groq.com
3. Ensure no extra spaces before/after the key
4. Restart the server

### Issue: "Rate limit exceeded"
**Symptom**: Too many requests error

**Fixes**:
- Free tier: 30 requests/minute
- Wait a minute and try again
- Upgrade to paid plan for higher limits

### Issue: Resume upload fails
**Symptom**: Upload returns error

**Fixes**:
1. Ensure file is PDF or DOCX format
2. Check file size (should be <10MB)
3. Try a different resume file
4. Check browser console for detailed error

### Issue: ATS score shows 0 or very low
**Symptom**: ATS analysis returns incorrect scores

**Fixes**:
- This is normal for the local ATS analyzer (doesn't use API)
- Ensure resume has proper sections (Experience, Education, Skills)
- Add technical keywords to improve score

---

## Verification Steps

### 1. Check Environment Setup
```bash
# On Windows (PowerShell)
Get-Content .env

# On Mac/Linux
cat .env
```
Expected output:
```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxx
PORT=5000
```

### 2. Test API Connection
```bash
# On Windows (PowerShell)
$env:GROQ_API_KEY = "your_key_here"
python -c "from groq import Groq; c = Groq(); print('✅ API connection OK')"

# On Mac/Linux
export GROQ_API_KEY="your_key_here"
python3 -c "from groq import Groq; c = Groq(); print('✅ API connection OK')"
```

### 3. Check Server Logs
When you run `python app.py`, look for:
- ✅ "Using Groq API for instant AI inference" - Good
- ⚠️ "GROQ_API_KEY not set" - Bad, add key to .env

### 4. Test Interview Feature
1. Upload a resume
2. Click "Start Interview"
3. Check browser console (F12) for any errors
4. Look at server console for error messages

---

## Advanced Troubleshooting

### Enable Debug Logging
Edit `app.py` and add after `app = Flask(...)`:
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

### Check Python Version
```bash
python --version
```
Requires Python 3.7+

### Verify Dependencies
```bash
pip list | grep groq
pip list | grep flask
```

### Test Groq Library Directly
```python
from groq import Groq
import os

api_key = os.getenv("GROQ_API_KEY")
print(f"API Key present: {bool(api_key)}")

if api_key:
    client = Groq(api_key=api_key)
    response = client.messages.create(
        model="mixtral-8x7b-32768",
        messages=[{"role": "user", "content": "Hello"}],
        max_tokens=10
    )
    print(f"✅ API works: {response.content[0].text}")
```

---

## Getting Help

1. **Groq Documentation**: https://console.groq.com/docs
2. **API Status**: https://status.groq.com
3. **Groq Support**: https://console.groq.com/support
4. **Check logs**: Look at the console output when running `python app.py`

---

## Quick Checklist

- [ ] Groq API key created at console.groq.com
- [ ] API key added to `.env` file
- [ ] No quotes around API key in `.env`
- [ ] Server restarted after adding API key
- [ ] Internet connection working
- [ ] Python 3.7+ installed
- [ ] Dependencies installed: `pip install -r requirements.txt`
- [ ] Server shows "Using Groq API" message on startup

If all checks pass, the system should work perfectly! 🚀
