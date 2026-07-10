#pip install -U pydantic-ai openai pydantic requests beautifulsoup4 pypdf python-docx streamlit
import argparse
from job_fit_core import (
    read_resume_from_path,
    read_job_description,
    create_agent,
    analyze_job_fit,
)


def main():
    parser = argparse.ArgumentParser(description="Analyze job fit from resume and job URL")
    parser.add_argument("--resume", required=True, help="Path to resume file (PDF, DOCX, or TXT)")
    parser.add_argument("--job-url", required=True, help="URL of job posting")
    args = parser.parse_args()

    print("Reading resume...")
    resume_text = read_resume_from_path(args.resume)

    print("Fetching job description...")
    jd_text = read_job_description(args.job_url)

    print("Analyzing job fit...")
    agent = create_agent()
    report = analyze_job_fit(resume_text, jd_text, agent)

    print("\n" + "="*60)
    print("Score:", report.overall_score)
    print("Recommendation:", report.recommendation)
    print("\nSummary:")
    print(report.summary)

    print("\nMatched Skills:")
    for skill in report.matched_skills:
        print(f"- {skill.skill}: {skill.match_level} | {skill.evidence_from_resume}")

    print("\nMissing / Weak Skills:")
    for skill in report.missing_or_weak_skills:
        print("-", skill)

    print("\nResume Improvements:")
    for item in report.resume_improvements:
        print("-", item)
    print("="*60)


if __name__ == "__main__":
    main()