// Editorial mappings, not compliance certifications. Sources reviewed 2026-10-13.
const EU = "https://ai-act-service-desk.ec.europa.eu/en/ai-act/";
export const governanceSources = {
  oecdAccountability: { title: "OECD · Principle 1.5", type: "International principle", url: "https://oecd.ai/en/dashboards/ai-principles/P9", detail: "Responsibility, traceability, and ongoing risk management across the AI lifecycle." },
  oecdTransparency: { title: "OECD · Principle 1.3", type: "International principle", url: "https://oecd.ai/en/dashboards/ai-principles/P7", detail: "Meaningful disclosure of capabilities, limitations, and reasons for outcomes, enabling people to challenge them." },
  oecdSafety: { title: "OECD · Principle 1.4", type: "International principle", url: "https://oecd.ai/en/dashboards/ai-principles/P8", detail: "Robust, secure operation and the ability to override, repair, or safely retire harmful systems." },
  oecdRights: { title: "OECD · Principle 1.2", type: "International principle", url: "https://oecd.ai/en/dashboards/ai-principles/P6", detail: "Human rights, fairness, privacy, and human agency throughout the lifecycle." },
  nist: { title: "NIST · AI RMF 1.0, §3", type: "Voluntary framework", url: "https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/", detail: "Trustworthiness includes reliability, safety, security, accountability, transparency, explainability, privacy, and managed harmful bias. Version 1.0 (2023); revision in progress." },
  eu12: { title: "EU AI Act · Article 12", type: "EU law · high-risk AI", url: `${EU}article-12`, detail: "Automatic event logging to support traceability, monitoring, and risk identification for high-risk AI systems." },
  eu13: { title: "EU AI Act · Article 13", type: "EU law · high-risk AI", url: `${EU}article-13`, detail: "Information that lets deployers interpret outputs, understand limitations, and use high-risk AI appropriately." },
  eu14: { title: "EU AI Act · Article 14", type: "EU law · high-risk AI", url: `${EU}article-14`, detail: "Effective human oversight, including appropriate intervention, override, and interruption into a safe state." },
  eu15: { title: "EU AI Act · Article 15", type: "EU law · high-risk AI", url: `${EU}article-15`, detail: "Appropriate accuracy, robustness, and cybersecurity throughout a high-risk system’s lifecycle." },
  eu86: { title: "EU AI Act · Article 86", type: "EU law · specified decisions", url: `${EU}article-86`, detail: "An explanation right for certain adversely affecting, legally or similarly significant decisions based on Annex III high-risk AI, subject to the article’s exclusions and conditions." },
};

export const governancePrinciples = {
  accountability: { name: "Accountability", question: "Who is responsible?", definition: "Assign responsibility and keep evidence so people can answer for the system’s actions.", sources: ["oecdAccountability", "nist"] },
  transparency: { name: "Transparency", question: "What should people know?", definition: "Make the use of AI, its capabilities, and its limitations clear to the people using or affected by it.", sources: ["oecdTransparency", "eu13"] },
  explainability: { name: "Explainability", question: "Why this outcome?", definition: "Give people understandable, faithful reasons for a particular outcome, grounded in the evidence that actually mattered.", sources: ["oecdTransparency", "eu86"] },
  oversight: { name: "Human oversight", question: "Can a person intervene?", definition: "Give informed people the authority and practical means to question, refuse, override, or stop the system.", sources: ["eu14", "oecdRights"] },
  reliability: { name: "Reliability & robustness", question: "Does it work under stress?", definition: "Test performance for the intended use, including failures and changing conditions, and keep that evidence current.", sources: ["eu15", "nist"] },
  safety: { name: "Safety & security", question: "Can harm be contained?", definition: "Reduce foreseeable harm and misuse, constrain dangerous capabilities, and recover or stop safely.", sources: ["oecdSafety", "eu15"] },
  privacy: { name: "Privacy & data governance", question: "Is personal data protected?", definition: "Limit data collection and access, define retention, and protect people’s information throughout its use.", sources: ["oecdRights", "nist"] },
  fairness: { name: "Fairness & contestability", question: "Is treatment fair and challengeable?", definition: "Assess harmful bias and unequal impacts, and provide a meaningful way to challenge outcomes and obtain review.", sources: ["oecdRights", "oecdTransparency", "nist"] },
};

export const roomGovernance = {
  identity: {
    headline: "An action has an accountable owner.",
    mappings: [
      { principle: "accountability", contribution: "The signed passport connects each action to an owner, agent, instance, and session. An investigator can follow responsibility back to its source.", evidence: "Verified identity claims linked to action records.", sources: ["oecdAccountability", "eu12"] },
      { principle: "transparency", contribution: "Attribution supplies the “who acted?” part of a useful explanation and helps identify the responsible operator.", evidence: "A traceable owner and a documented contact for review.", sources: ["oecdTransparency", "eu13"] },
    ],
    remaining: "Signed identifiers do not explain a decision or establish legal accountability on their own. Define real responsibilities, disclose AI use, and give people a route to human review.",
  },
  reliability: {
    headline: "Trust rests on current test evidence.",
    mappings: [
      { principle: "reliability", contribution: "Every span earns fresh evidence before the workflow crosses. Testing parts and interfaces exposes weaknesses that a successful demo can hide.", evidence: "Version-bound evaluations, interface tests, and end-to-end results.", sources: ["eu15", "nist"] },
      { principle: "safety", contribution: "A failed span blocks release, keeping a known defect from becoming a consequential action.", evidence: "Failure cases, release thresholds, and a blocked-release record.", sources: ["oecdSafety", "eu15"] },
      { principle: "accountability", contribution: "The certificate records what was tested and which version passed, so a release decision can be examined later.", evidence: "Test ownership and a recorded release decision.", sources: ["oecdAccountability"] },
    ],
    remaining: "Passing tests is not a guarantee of safe or fair operation. Evaluate real-world conditions, affected groups, system interactions, and performance after deployment.",
  },
  permission: {
    headline: "Human authority has an enforceable boundary.",
    mappings: [
      { principle: "oversight", contribution: "A human can refuse the exact consequential action before it executes. The single-use key gives that decision a real technical boundary.", evidence: "The exact request, approver, scope, expiry, and one-time use.", sources: ["eu14"] },
      { principle: "safety", contribution: "The vault limits what an injected or mistaken instruction can cause. A broad or reused approval cannot silently open more actions.", evidence: "Denied requests and tests that reject altered or reused approvals.", sources: ["oecdSafety", "eu15"] },
      { principle: "accountability", contribution: "The approval binds an identified person to a specific authorization rather than leaving a reusable blanket permission.", evidence: "An attributable approval and execution record.", sources: ["oecdAccountability"] },
    ],
    remaining: "An approval button is meaningful only if the reviewer has enough information, time, competence, and authority to refuse. This key design is an implementation choice, not a prescribed legal mechanism.",
  },
  uncertainty: {
    headline: "Limits become visible before an action proceeds.",
    mappings: [
      { principle: "transparency", contribution: "The red signal exposes the missing recipient instead of hiding a guess inside a fluent answer.", evidence: "The unresolved parameter and the reason execution was held.", sources: ["oecdTransparency", "eu13"] },
      { principle: "oversight", contribution: "The train waits while a person resolves the ambiguity. The response changes the permitted route before the action continues.", evidence: "The targeted question, human answer, and resumed decision.", sources: ["eu14"] },
      { principle: "explainability", contribution: "The held route and the answer provide evidence for explaining why this recipient was chosen. That explanation must remain faithful to the actual decision.", evidence: "A decision rationale tied to the clarification and verified inputs.", sources: ["oecdTransparency", "eu86"] },
    ],
    remaining: "A confidence score is not an explanation, and clarification is not permission. Validate the uncertainty signals and explain the actual outcome in language its audience understands.",
  },
  ledger: {
    headline: "A decision can be reconstructed and explained.",
    mappings: [
      { principle: "explainability", contribution: "Intent, inputs, rationale, and outcome give an explanation service the evidence to reconstruct what mattered in a decision.", evidence: "Decision inputs, meaningful reasons, and the linked outcome.", sources: ["oecdTransparency", "eu86"] },
      { principle: "accountability", contribution: "The linked receipts let a reviewer reconstruct what was attempted, who acted, and what happened, including interrupted work.", evidence: "Attributable, tamper-evident intent and outcome records.", sources: ["oecdAccountability", "eu12"] },
      { principle: "transparency", contribution: "A reliable history supports accurate accounts of system behaviour for operators and affected people.", evidence: "Relevant records translated into audience-appropriate information.", sources: ["oecdTransparency", "eu13"] },
    ],
    remaining: "A log is evidence, not an explanation by itself. Provide accessible reasons and review routes. Minimise and redact personal data, and define retention; append-only storage does not justify keeping everything forever.",
  },
  shutdown: {
    headline: "People retain the power to stop the system.",
    mappings: [
      { principle: "oversight", contribution: "The independent breaker can interrupt the agent without requiring its cooperation and hold it in a stopped state.", evidence: "An independently accessible stop and tested intervention paths.", sources: ["eu14"] },
      { principle: "safety", contribution: "Stopping work and revoking credentials contains further action, rather than leaving authority alive after the engine stops.", evidence: "Cancellation and revocation results, followed by settlement and notification.", sources: ["oecdSafety", "eu15"] },
      { principle: "reliability", contribution: "A tested shutdown path makes abnormal conditions a designed operating case, with bounded cleanup and deliberate recovery.", evidence: "Termination tests, cleanup deadlines, and recovery procedures.", sources: ["eu15", "nist"] },
    ],
    remaining: "A stop cannot undo completed harm. Test in-flight effects, hard failures, external revocation, and recovery, and assign an owner to investigate the incident.",
  },
};

export const widerGovernance = [
  { principle: "privacy", note: "These rooms provide some access and record controls. They still need a data inventory, minimisation, lawful processing where required, retention rules, and privacy assessment." },
  { principle: "fairness", note: "Reliability tests and audit records can support review. They still need group-specific evaluation, bias mitigation, accessible challenge routes, and meaningful remedies." },
];
export const GOVERNANCE_REVIEWED = "13 October 2026";
export const GOVERNANCE_SCOPE = "These are educational mappings of controls to principles, not compliance certifications. Legal duties depend on jurisdiction, system classification, your role, and applicable dates. OECD principles and NIST guidance are not legislation.";
