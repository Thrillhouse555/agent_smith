# Agent Smith — AI Assisted QA Engineering Agent

## Project Overview

**Project Name:** Agent Smith

**Purpose:**
Agent Smith is an experimental AI-assisted QA engineering platform designed to investigate whether small, low-cost AI models can meaningfully improve the daily workflow of a QA engineer.

The project explores the question:

> Can a lightweight AI model assist QA engineers with repetitive analysis, debugging, and test administration tasks without requiring expensive large-scale AI infrastructure?

The goal is not to replace QA engineers, but to augment their capabilities by reducing administrative overhead and allowing more time to be spent on exploratory testing, risk analysis, and complex quality challenges.

---

# Background

Modern AI tools have demonstrated strong capability in software engineering and automation workflows. However, many advanced AI agents rely on expensive models with significant credit/token costs.

Previous experiments using AI-powered tooling showed that:

* Large AI models produce high-quality analysis.
* Smaller local models reduce cost and improve privacy.
* Smaller models can still provide useful conversational assistance.
* The challenge is identifying practical QA workflows where a smaller model provides measurable value.

Agent Smith investigates whether a lightweight local model can support QA activities such as:

* Test failure analysis
* Error summarisation
* Historical failure pattern detection
* Flaky test identification
* Regression investigation
* Test execution reporting

---

# Project Vision

Create an AI-assisted QA companion that integrates into a test execution workflow.

The system should:

1. Receive test execution results.
2. Display test activity through a chat-style interface.
3. Detect failed tests.
4. Automatically trigger investigation workflows.
5. Analyse logs and failure information using AI.
6. Produce a concise summary suitable for defect reporting.
7. Identify possible patterns such as:

   * Known flaky tests
   * Previous unresolved failures
   * Related changes
   * Environmental issues

---

# AI Model Strategy

We will use our previous setup for calling on our AI agent as we used previous from Jenkins automating mjs scripts.

See examples in cypress/scripts/

# Key Features

## 1. Test Execution Monitoring

The system should consume test results from automated test runs.

Possible inputs:

* Test framework reports
* CI pipeline outputs
* Console logs
* Stack traces
* Kibana logs

---

## 2. Chat-Based QA Interface

The user interface should provide:

* Test execution updates
* AI-generated analysis
* Conversational querying
* Investigation history

Example interaction:

```
QA Engineer:
Why did LoginTest fail?

Agent Smith:
The test failed due to a timeout waiting for the authentication element.

Historical analysis:
- This test has failed 7 times in the last 100 runs.
- Previous failures occurred after UI deployment changes.
- Recommendation: investigate selector stability.
```

---

## 3. Failure Analysis Agent

When a test fails:

The AI should analyse:

* Error messages
* Stack traces
* Logs
* Previous failures
* Recent changes

Output:

* Failure summary
* Possible cause
* Confidence level
* Recommended next steps

---

## 4. Flaky Test Detection

The system should maintain historical test execution data.

AI should identify:

* Frequently failing tests
* Intermittent failures
* Environment-related failures
* Tests requiring additional retries

Example:

```
Test: CheckoutPaymentTest

Failure frequency:
12 failures / 500 executions

Pattern:
Failures occur mainly during peak execution times.

Classification:
Potentially flaky

Recommendation:
Retry automatically before raising defect.
```

---

## 5. Regression Intelligence

The system should analyse whether failures relate to:

* Recent code changes
* Previous defects
* Known issues
* Configuration changes

---

# Non-Goals

Agent Smith should NOT:

* Replace human QA decision making.
* Automatically modify production systems.
* Close defects without human approval.
* Make unverified assumptions.
* Hide failures from engineers.

Human review remains the final decision point.

---

# Suggested Architecture

## High-Level Components

```
+----------------+
| Test Framework |
+----------------+
        |
        v
+----------------+
| Result Parser  |
+----------------+
        |
        v
+----------------+
| Agent Smith API|
+----------------+
        |
        +----------------+
        |                |
        v                v
+-------------+    +-------------+
| Database    |    | AI Engine   |
| History     |    | Ollama      |
+-------------+    +-------------+
        |
        v
+----------------+
| Chat UI        |
+----------------+
```

---

# Recommended Initial Technology Choices

These are suggestions only and should remain flexible.

## Backend

Use our API from my-api/ to send data to our DB (which could then be clear after 30 days?)

Responsibilities:

* Receive test results
* Manage conversations
* Connect to AI models
* Store historical data

---

## Frontend

A HTML/Javascript web page in for the website to link to which shows a chat window listing tasks happening and time when they happened.

Requirements:

* Chat interface
* Test status display
* AI responses
* Investigation history

---

## Storage

Initial requirements:

Store:

* Test runs
* Failure messages
* AI summaries
* Retry history
* User feedback

---

# Development Principles

When assisting with this project:

## Prioritise:

* Simple architecture
* Clear separation of concerns
* Extensible AI integration
* Local-first development
* Explainable AI output

## Avoid:

* Over-engineering
* Vendor lock-in
* Hidden AI decisions
* Complex infrastructure before validation

---

# Coding Guidelines

All generated code should:

* Follow clean coding principles.
* Include comments where AI behaviour is unclear.
* Include unit tests.
* Prefer maintainability over clever solutions.
* Keep AI prompts separate from application logic.
* Use configuration files instead of hard-coded values.

---

# AI Prompt Design Principles

AI prompts should:

* Provide relevant context.
* Clearly define expected output.
* Request structured responses where possible.
* Avoid asking the model to make unsupported assumptions.

Example:

```
Analyse this failed automated test.

Provide:

1. Failure summary
2. Likely cause
3. Confidence score
4. Recommended next action

Do not invent missing information.
```

---

# Testing Strategy

Agent Smith itself should be tested.

Required testing:

## Unit Testing

Test:

* Log parsing
* Result processing
* AI response handling

## Integration Testing

Test:

* Test framework integration
* AI model communication
* Database persistence

## AI Evaluation Testing

Measure:

* Accuracy of summaries
* False assumptions
* Useful recommendations

---

# Future Roadmap

## Phase 1 — Foundation

* Chat interface
* Test result ingestion
* Ollama integration
* Basic failure summaries

## Phase 2 — Intelligence

* Historical analysis
* Flaky test detection
* Failure classification

## Phase 3 — Advanced Agent Behaviour

* Automated investigation
* Suggested fixes
* Code change analysis
* CI/CD integration

---

# Project Philosophy

Agent Smith should represent a practical approach to AI adoption:

Small models.
Low cost.
Real value.

The objective is not creating an autonomous AI engineer.

The objective is creating a reliable QA assistant that removes repetitive work and helps engineers focus on quality.

---

# Copilot Instructions

When contributing to Agent Smith:

* Think like a QA engineer first.
* Prefer solutions that improve testing workflows.
* Keep AI capabilities realistic.
* Design components so AI models can be swapped.
* Explain trade-offs between simplicity and capability.
* Suggest improvements but avoid unnecessary complexity.
* Remember that human QA judgement remains essential.

Agent Smith assists the engineer.

Agent Smith does not replace the engineer.
