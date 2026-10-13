# Governance mapping rationale

Reviewed: 13 October 2026. This is an editorial mapping of the six illustrated controls to recognised governance principles. A room demonstrates a contribution to governance; it does not certify a system or discharge all legal obligations.

| Room | Principles supported | Contribution and boundary |
| --- | --- | --- |
| Passport Checkpoint | Accountability; transparency | Attribution identifies actors. It still requires organisational ownership, disclosure, and review contacts. |
| Proof Bridge | Reliability and robustness; safety and security; accountability | Versioned evaluations support release decisions. Deployment monitoring, group-level evaluation, and system tests remain necessary. |
| Single-Use Vault | Human oversight; safety and security; accountability | An informed person can refuse an exact action. Signed, expiring, one-use approvals are this illustration’s implementation choice, not a mandated legal design. |
| Clarification Junction | Transparency; human oversight; explainability | Missing evidence becomes visible and a person resolves it. The resulting explanation must be faithful to the actual decision; clarification is not authorization. |
| Evidence Press | Explainability; accountability; transparency | Records supply evidence for reconstruction and explanation. Raw logs and generated rationales alone do not establish a faithful, understandable explanation. |
| Emergency Power Room | Human oversight; safety and security; reliability and robustness | Intervention stops work and authority. Incident review, hard-failure paths, and recovery still need implementation. |

## Official references

- [OECD Principle 1.2 — Human rights, fairness, and privacy](https://oecd.ai/en/dashboards/ai-principles/P6): also informs the explicit gaps in privacy and fairness coverage.
- [OECD Principle 1.3 — Transparency and explainability](https://oecd.ai/en/dashboards/ai-principles/P7): informs the distinction between disclosure, an understandable explanation, and a route to challenge an outcome.
- [OECD Principle 1.4 — Robustness, security, and safety](https://oecd.ai/en/dashboards/ai-principles/P8): informs safe operation and intervention.
- [OECD Principle 1.5 — Accountability](https://oecd.ai/en/dashboards/ai-principles/P9): informs responsibility and traceability.
- [NIST AI RMF 1.0, section 3 — AI risks and trustworthiness](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/): voluntary framework, version 1.0 (2023). The official site reports a revision in progress.
- [EU AI Act Article 12 — Record-keeping](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-12): legal reference for high-risk AI logging.
- [EU AI Act Article 13 — Transparency and information to deployers](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-13): high-risk AI information and interpretation requirements.
- [EU AI Act Article 14 — Human oversight](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14): high-risk AI oversight; paragraph 4 includes override and safe interruption.
- [EU AI Act Article 15 — Accuracy, robustness, and cybersecurity](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-15): high-risk AI performance and resilience requirements.
- [EU AI Act Article 86 — Explanation of individual decision-making](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-86): a conditional right concerning certain adversely affecting decisions based on Annex III high-risk systems, with the article’s exclusions and conditions. It is not a universal right covering all AI outputs.

The European Commission’s AI Act Explorer identifies its displayed text as the consolidated version dated 27 July 2026. The app links to the individual articles and labels their scope, without asserting that every obligation applies to every agent or that all application dates have passed. OECD recommendations and the NIST framework are not legislation.

The eight teaching categories in the app are a practical synthesis, not a claim that all sources use an identical taxonomy. In particular, fairness and contestability have related but distinct requirements. The six rooms do not fully address privacy, fairness, accessibility, wider human rights, or social and environmental impacts.

## Introduction

The opening slide makes an editorial argument for governance during agent development. The flow from frontier models to developer-built agents and consequential tools is conceptual, not a measured estimate of who causes the most harm. It does not claim that model developers alone are currently regulated or that downstream builders cause most incidents.

Its context panel links to [NIST’s AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework), which covers trustworthiness across design, development, use, and evaluation, and [OECD’s Agentic AI in organisations (2026)](https://www.oecd.org/en/publications/agentic-ai-in-organisations_1257a26f-en.html), which examines adoption and governance through practitioner interviews. The six illustrated safeguards complement wider governance and regulation. Sources checked 13 October 2026.
