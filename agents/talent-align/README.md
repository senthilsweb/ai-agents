# Job Fit Analyzer

AI-powered resume analysis with deterministic scoring and cover letter generation.

## Setup

### 1. Create Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements-job-fit.txt
```

### 3. Configure API Key

Create a `.env` file in the project root:

```bash
API_KEY=your-openai-api-key-here
```

Or set the environment variable directly:

```bash
export OPENAI_API_KEY=your-openai-api-key-here
```

## Usage

### Web App (Streamlit)

```bash
source .venv/bin/activate
streamlit run app.py
```

Open **http://localhost:8501** in your browser.

**Steps:**
1. Upload resume (PDF/DOCX/TXT) in the sidebar
2. Paste job posting URL in the chat input
3. View analysis dashboard with score breakdown
4. Download cover letter (MD/PDF/DOCX)
5. Export full JSON report

### CLI Version

```bash
source .venv/bin/activate
python cli.py --resume /path/to/resume.pdf --job-url https://example.com/job
```

**Options:**

| Flag | Description |
|------|-------------|
| `--resume` | Path to resume file (PDF/DOCX/TXT) - required |
| `--job-url` | Job posting URL - required |
| `--output`, `-o` | Output file path (default: stdout) |
| `--pretty` | Pretty print JSON output |

**Examples:**

```bash
# Output to terminal
python cli.py --resume resume.pdf --job-url https://example.com/job --pretty

# Save to file
python cli.py --resume resume.pdf --job-url https://example.com/job -o report.json
```

## Features

### Deterministic Scoring (100 points)

| Category | Points | Calculation |
|----------|--------|-------------|
| Required Skills | 40 | (matched / total) * 40 |
| Preferred Skills | 20 | (matched / total) * 20 |
| Experience Match | 20 | Years alignment score |
| Domain Alignment | 20 | Industry relevance score |

### Match Status

| Status | Score Range |
|--------|-------------|
| Strong Match | 80-100 |
| Good Match | 65-79 |
| Moderate Match | 50-64 |
| Weak Match | 35-49 |
| No Match | 0-34 |

### Cover Letter Generation

- Template-based with mustache-style placeholders
- Downloads in Markdown, PDF, and Word formats
- Customizable templates in `templates/` folder

### Full JSON Report

The JSON report includes:
- Job URL and raw job description
- Resume filename and extracted text
- Complete analysis with score breakdown
- Formatted cover letter
- Candidate information

## Project Structure

```
langflow/
├── app.py                    # Streamlit web application
├── cli.py                    # Command-line interface
├── requirements-job-fit.txt  # Python dependencies
├── .env                      # API key configuration
├── templates/
│   ├── cover_letter.txt      # Text template
│   └── cover_letter.html     # HTML template
└── prompts/
    ├── system_prompt.txt     # AI system instructions
    └── analysis_prompt.txt   # Analysis prompt template
```

## Configuration

### Candidate Info

Edit `CANDIDATE_INFO` in `app.py` or `cli.py`:

```python
CANDIDATE_INFO = {
    "name": "Your Name",
    "title": "Your Title",
    "email": "your@email.com",
    "phone": "123-456-7890",
    "location": "City, State",
    "linkedin": "linkedin.com/in/yourprofile",
    "github": "github.com/yourusername",
    "website": "yourwebsite.com"
}
```

### Templates

Customize cover letter templates in `templates/` folder using mustache-style placeholders:

- `{{candidate_name}}`, `{{candidate_email}}`, etc.
- `{{paragraph_1}}` through `{{paragraph_4}}`
- `{{date}}`

### Prompts

Modify AI behavior by editing files in `prompts/` folder:

- `system_prompt.txt` - Scoring formula and instructions
- `analysis_prompt.txt` - Analysis request template
