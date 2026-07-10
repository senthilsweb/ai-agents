# Mob Inception -- AI Job Fit Matching Agent

## Mission

Design and implement an AI-powered Job Fit Matching Agent that evaluates
how well a candidate's resume matches a job description and provides
actionable recommendations.

## Business Problem

Job seekers spend significant time manually tailoring resumes for each
application.

The solution should automatically compare a candidate's resume with a
job description and generate an explainable job-fit assessment, helping
users improve their chances of passing Applicant Tracking Systems (ATS)
and recruiter reviews.

## Target Users

-   Job Seekers
-   Recruiters
-   Career Coaches
-   Hiring Managers

## Business Goals

-   Reduce manual resume review effort.
-   Improve ATS compatibility.
-   Provide explainable AI recommendations.
-   Generate structured outputs suitable for automation.
-   Support future integrations with job portals.

## Scope

### Inputs

-   Public Job Description URL
-   Local Resume (PDF, DOCX, TXT)

### Outputs

-   Overall Match Score (0--100)
-   Recommendation
-   Executive Summary
-   Matching Skills
-   Missing Skills
-   Resume Improvements
-   ATS Keyword Gaps
-   Cover Letter Angle

## Functional Requirements

The system shall: 1. Accept a local resume. 2. Accept a public job URL.
3. Extract readable text from both sources. 4. Compare skills,
experience, education, certifications, and responsibilities. 5. Score
the overall match. 6. Explain every score using evidence from the
resume. 7. Never invent candidate experience. 8. Return valid JSON. 9.
Display the report in chat/UI. 10. Allow the report to be downloaded.

## Non-Functional Requirements

-   Explainable AI
-   Deterministic output
-   JSON Schema validation
-   Retry on malformed responses
-   Secure API key handling
-   Modular architecture
-   Provider independent
-   OpenAI-compatible APIs
-   Easy Langflow integration

## User Stories

### Story 1

As a job seeker, I want to upload my resume so that I can evaluate my
suitability for a job.

### Story 2

As a user, I want to paste a job URL so that I don't manually copy the
description.

### Story 3

As a recruiter, I want an explainable score so that I understand why the
candidate received that rating.

### Story 4

As a career coach, I want resume improvement suggestions so that I can
guide my clients.

## Acceptance Criteria

Given: - Resume PDF/DOCX/TXT - Valid Job URL

When: - The evaluation runs

Then: - Resume is extracted - Job description is extracted - Comparison
succeeds - Score is generated - Evidence is shown - JSON validates
successfully

## AI Prompt

You are an expert recruitment assistant.

Compare the resume against the supplied job description.

Only use information present in the resume.

Do not hallucinate experience.

Return only valid JSON matching the supplied schema.

## JSON Schema

``` json
{
  "overall_score": 0,
  "recommendation": "",
  "summary": "",
  "matched_skills": [],
  "missing_skills": [],
  "ats_keywords_missing": [],
  "resume_improvements": [],
  "cover_letter_angle": ""
}
```

## Suggested Architecture

``` text
Resume PDF/DOCX
        │
        ▼
 Resume Parser
        │
        ▼
Job URL Scraper
        │
        ▼
Prompt Builder
        │
        ▼
OpenAI Chat Completion
        │
        ▼
Structured Output Validator
        │
        ▼
Job Fit Report
```

## Risks

-   Poorly formatted resumes
-   JavaScript-heavy job sites
-   Hallucinated recommendations
-   Token limits
-   Long job descriptions

## Assumptions

-   Public job URLs are accessible.
-   Resume contains extractable text.
-   LLM supports JSON mode.
-   Internet connectivity is available.

## Future Enhancements

-   ATS score
-   Tailored resume generation
-   Cover letter generation
-   LinkedIn profile analysis
-   Batch comparison against multiple jobs
-   Interview question generation
-   Salary benchmarking
-   Skill gap learning roadmap

## Mob Inception Collaboration

### Human Product Owner

-   Defines business vision, goals, constraints, priorities, and success
    criteria.
-   Reviews and approves requirements and evaluations.

### AI Agents

-   Business Analyst Agent
-   Solution Architect Agent
-   AI Engineer Agent
-   Evaluation Agent
-   Backend Engineer Agent
-   Frontend Engineer Agent
-   QA Agent
-   Security Agent
-   DevOps Agent
-   Reviewer/Critic Agent

## Definition of Done

The feature is complete when a user can upload a resume, provide a
public job URL, invoke the workflow, and receive a validated structured
job-fit report with score, evidence, identified gaps, and actionable
improvement suggestions.
