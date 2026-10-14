# The Governance House — 20-minute Microsoft Foundry talk track

**Tone:** conversational, curious, practical, lightly funny.

**Running example:** a fictional retailer called Northstar, building a customer-support and refunds agent in Microsoft Foundry.

**Directions in italics are not spoken.**

## Opening — “Because you are the risk” (about 2½ minutes)

*Start on the cover, “You are the Governance Layer.” Look at the audience before looking at the screen. Click “Begin the talk” to show the introduction.*

AI safety conversations have a habit of getting very dramatic, very quickly.

We start with a chatbot… and four minutes later somebody is discussing the end of civilisation.

Those big questions matter. But I want to talk about a much less cinematic problem.

Tuesday morning. Nine fifteen. Our fictional retailer—let’s call it Northstar—opens Microsoft Foundry and builds a customer-support agent.

*Let the model layer appear.*

The team chooses a model from the catalogue. They give the agent access to the order system, the customer database, and a refund API. By lunch, it can answer “Where is my order?” By Friday, somebody wants it handling refunds.

That is the moment this presentation is about.

The model didn’t connect itself to the refund API. The model didn’t choose its permissions. It didn’t add the Send button.

We did.

*Move to “Everyday builders.”*

Foundry makes it genuinely easy to build an agent. You can create a prompt agent in the portal, or bring code written with Agent Framework, LangGraph, the OpenAI Agents SDK, or your own framework and run it as a hosted agent.

That convenience is useful. It also means the distance between “interesting demo” and “system that can affect a customer” is now very short.

Northstar’s agent can write a perfectly fluent response and still expose the wrong address. It can follow a refund instruction beautifully and return £900 instead of £90.

Very capable. Very polite. Very expensive.

*Move to “Governance by design.”*

So the useful question is not simply, “Is the model safe?”

It is: “What happens between the model suggesting an action and our system actually doing it?”

I’ve organised that as a house, because apparently the only way to make governance interesting is to give it property.

There are six rooms. In each one, we’ll look at a safeguard and then make it concrete in Azure: what Foundry gives us, what another Azure service can add, and what we still have to build ourselves.

No magic shield. No single “responsible AI” toggle. Just six boundaries we can implement and test.

*Click “Explore the six safeguards.”*

Let’s go inside.

---

## 1. The Passport Checkpoint — Identity (about 2½ minutes)

*Let the anonymous parcel reach the gate.*

First room: identity.

This parcel represents an action leaving the agent. Maybe it is reading an order, sending a reply, or requesting a refund.

Right now, it has no passport, so the gate stays shut.

That sounds obvious. But plenty of real systems still have one API key called something like `support-automation-prod` shared by several bots.

Then £900 goes to the wrong customer and the incident review begins with: “Well… it was definitely one of the automations.”

That is not identity. That is a suspect lineup where everybody is wearing the same coat.

*Let the four stamps appear.*

For Northstar, we want four things attached to the action: the accountable owner, the agent version, the running instance, and the individual session.

Microsoft Foundry gives us a strong starting point here. When we publish the agent, it gets a distinct agent identity in Microsoft Entra ID. Instead of hiding a long-lived secret in code, Foundry can obtain an Entra token for that agent when it calls a downstream tool.

Then we use Azure role-based access control to give that identity only the access it needs.

Northstar’s support agent might receive permission to read order records. It does not need Owner on the subscription. Nobody has ever fixed a customer’s missing parcel by creating a virtual network.

*Let the checkpoint verify the signature.*

When the agent calls our order API or an authenticated MCP server, the service validates the Entra token. Now we are checking a signed identity, not trusting a header that says `agent-name: honest-refund-bot`.

For an attended experience, Foundry can also use delegated access so the action carries the user’s authority. For unattended work, the agent acts under its own narrowly scoped identity.

We add the Foundry agent version, session ID, and our own action ID to the OpenTelemetry trace sent to Application Insights. Now that refund can be traced to a real deployment and conversation.

*Let the gate open.*

But remember: identity is not permission. An Entra token proves which agent is calling. It does not mean every call should be allowed.

A passport gets you through passport control. It does not let you fly the plane.

So the implementation here is: publish the agent for a distinct identity, assign narrow RBAC roles, verify tokens at every tool boundary, and carry the trace and action IDs downstream.

No verified identity, no passage.

*Move on.*

---

## 2. The Proof Bridge — Reliability (about 2¾ minutes)

*Let the three bridge spans appear.*

Next is reliability.

Northstar’s agent does not perform one magical step. It retrieves the order, checks the refund policy, calculates the amount, and calls the refund tool.

It is less like one giant brain and more like a slightly anxious relay team. Every runner has to pass the baton.

Imagine order lookup is excellent and the refund API is excellent, but the policy step thinks “30 days” means “30 working days.”

Congratulations. We have built a very reliable system for issuing the wrong refund.

*Let the middle span fail.*

This is where Foundry evaluations become useful.

Before release, Northstar creates a test dataset: normal returns, orders just outside the window, missing receipts, duplicate requests, tool time-outs, amounts in pounds and pence—the examples that never appear in the happy-path demo.

In Foundry, we can run full-conversation evaluations using synthetic or existing conversations. Built-in evaluators can measure things such as task completion, tool-call accuracy, groundedness, and safety. For Northstar’s refund rules, we add a custom evaluator: did the agent apply the correct policy and calculate the exact amount?

Then we set release thresholds. If task completion is high but refund accuracy falls below the agreed threshold, the pipeline blocks the new agent version.

That is the missing piece in many AI demos: “Looks good to me” is not a deployment gate.

*Repair and retest the span.*

When the prompt, model, tool schema, or business rule changes, we run the tests again against that version.

Old evaluations belong to old software. You cannot put last year’s MOT certificate on a different car and call it roadworthy.

*Let the joins lock.*

Foundry evaluation does not replace normal software testing. We still contract-test the order and refund APIs. If one returns `order_total` and the next expects `amount`, both components can pass separately while the customer gets nothing.

After deployment, Application Insights collects the traces. Foundry can evaluate sampled production interactions and show recurring tool failures, latency, token usage, and quality changes. Azure Monitor alerts the team when the operational metrics cross a threshold.

The implementation is a loop: test each span, test the interfaces, gate the release, then watch real traces for drift.

Not “Is the agent smart?”

“Which exact behaviour has evidence—and which part are we just feeling optimistic about?”

*Move on.*

---

## 3. The Single-Use Vault — Permission (about 2¾ minutes)

*Let the read action use the open lane.*

Room three is permission.

Not every action deserves the same security.

Looking up an order is one thing. Refunding it is another. Drafting an apology is one thing. Sending ten thousand apologies because of a loop is very much another.

So Northstar gives read-only tools an open lane. The consequential tool—the refund API—goes behind a separate execution boundary.

*Let the refund request stop at the vault.*

RBAC helps us narrow which agent can reach which service, but RBAC alone is too broad for this moment. If the agent identity has permanent permission to issue refunds, a malicious instruction hidden in a support ticket may still reach that tool.

Giving an agent the tool and writing “Please be careful” in the system prompt is not access control. That is a Post-it note on a chainsaw.

*Let the approval key appear.*

With Microsoft Agent Framework, a function tool can require human approval. The run returns an approval request containing the tool name and arguments instead of executing immediately.

Northstar’s UI can now show a reviewer something concrete:

“Refund order 4817. Amount: £90. Reason: damaged item. Requested by support agent version 12.”

The reviewer approves or rejects that call, and the result goes back into the run.

That is a useful primitive—but it is not the whole vault.

Northstar’s execution service should revalidate the request at the boundary. The approval needs to be signed, short-lived, bound to the exact order and amount, and consumed atomically when the refund happens.

Otherwise an approval for £90 becomes an approval for £900, or two fast requests both use the same “one-time” decision.

*Let the key open the vault and disappear.*

We can use a durable workflow—Azure Durable Functions is one option—to pause while the human decides. But the refund service, not the model, is the final enforcement point.

And the approval screen needs enough context to make “no” a realistic choice. A dialog that only says “Agent wants access—Allow?” is not oversight. It is a reflex test.

*Let the reuse attempt fail.*

The second attempt fails because the approval has already been consumed.

So the implementation is: separate the dangerous tool, pause with a human-in-the-loop approval, bind that approval to the exact call, and enforce one-time use at the API boundary.

One action. One informed decision. One use.

*Move on.*

---

## 4. The Clarification Junction — Uncertainty (about 2½ minutes)

*Let the train approach the fork.*

The instruction here is: “Refund Alex’s last order.”

Northstar has two customers called Alex Morgan.

If you have ever worked with customer data, you now understand the entire field of uncertainty management.

The model can make a smart guess. One Alex contacted support yesterday. The other made a purchase this morning. It can explain its choice in beautiful prose.

It is still a guess.

*Keep the signal red.*

In our Foundry agent, we define the refund tool with required fields: customer ID, order ID, amount, reason, and approval reference.

Before the tool call, our application-level policy checks those fields. Is the customer ID unique? Do the retrieved order and conversation refer to the same person? Do the sources agree? Is this a high-impact action?

This is important: Foundry does not have a magic “uncertainty solved” switch. And we should not simply ask the model, “How confident are you?”

Confidently wrong is one of AI’s more established product features.

Foundry can help us test this behaviour. We build ambiguous examples into the evaluation dataset and add a custom evaluator: when identity is not unique, does the agent ask rather than act? In production, the trace shows the retrieval results, the proposed tool arguments, and where the action was held.

*Show the clarification question.*

The agent asks: “Do you mean Alex Morgan on order 4817 or Alex Morgan on order 6234?”

Not “Please provide more context.” Nobody enjoys receiving homework from a robot.

If the workflow is long-running, a Durable Functions orchestration can wait for an external event carrying the answer. The state survives while the agent waits. We validate the response, attach it to the original action ID, and then re-run the policy check.

*Resolve the route.*

The human selects order 4817. Only that route opens.

The threshold depends on consequence. If the agent recommends a phone case, let it make a reasonable guess. If it is moving money or disclosing customer data, it should become dramatically less adventurous.

And clarification is not approval. Identifying the right Alex answers “which one?” It does not answer “may we refund this order?” That still belongs at the vault.

The implementation is not a confidence number. It is a runtime gate, tested on ambiguous cases, that knows when to stop and ask one useful question.

*Move on.*

---

## 5. The Evidence Press — Ledger (about 2¾ minutes)

*Let the intent receipt enter the archive.*

This room is about receipts.

And I do not mean logging absolutely everything until the Azure bill becomes the incident.

I mean keeping enough evidence to reconstruct one important action.

Northstar’s customer clicks Refund. The page spins for slightly too long. Then it says, “Something went wrong.”

Fantastic. But did the refund happen?

The customer checks their email. Nothing. The bank says pending. They are now the proud owner of Schrödinger’s refund.

*Let the machine execute.*

Foundry tracing and Application Insights help a lot. With OpenTelemetry, we can see the agent run, model calls, tool calls, latency, errors, and dependencies under one trace.

But ordinary telemetry is not automatically our write-ahead evidence system.

Before Northstar calls the refund API, the execution service writes an intent record: action ID, verified agent and user identities, order, amount, approval reference, policy version, and timestamp.

Only after that write is acknowledged do we make the external call.

For ordinary cases, this could be a carefully permissioned append-only event store. For higher-integrity records, Azure Confidential Ledger provides an immutable, append-only store with cryptographic transaction receipts.

*Append the outcome.*

After the refund call, we append the provider result under the same action ID: success, failure, or unknown.

Unknown matters. If the process crashes after the provider accepts the refund but before we record the response, we do not pretend it failed and try again. We reconcile using the provider receipt or an idempotency key.

*Seal the chain, then show tampering.*

Application Insights gives us excellent operational traces. The ledger gives us protected evidence for the critical side effect. They share correlation IDs, but they have different jobs.

And we still minimise the data. Do not pour customer messages, card details, or secrets into the ledger because “audit.” Store references and the minimum evidence needed. Apply access controls and retention to the telemetry.

At the end, an investigator should answer four questions without assembling a detective agency:

What did the agent intend to do? Who allowed it? What actually happened? And what is still unknown?

The implementation is: trace the journey in Application Insights, write critical intent before execution, append the outcome after it, and protect the evidence according to its risk.

That is the difference between lots of logs and a usable record.

*Move on.*

---

## 6. The Emergency Power Room — Shutdown (about 2¾ minutes)

*Let the engine run.*

Last room. My personal favourite, because every ambitious automated system should come with a large, satisfying off switch.

Northstar’s agent hits a bug. Every failed refund creates two retries. Ten calls become twenty, then forty, and somebody asks the traditional incident-response question:

“Is the dashboard supposed to do that?”

We have reached the exciting part of the demo.

*Let the limit rise.*

There are several useful Azure controls here.

Foundry’s monitoring view uses Application Insights data to show token usage, latency, success rates, and evaluation results. Azure Monitor can alert on error or cost signals. If model traffic goes through Azure API Management, an `llm-token-limit` policy can enforce per-agent token rates and quotas instead of merely drawing a graph of the money leaving.

Those are tripwires. We still need the breaker.

*Trip the breaker.*

Northstar keeps a durable stop state outside the agent. Every workflow dispatch and every consequential tool checks it. An operator-facing endpoint—protected with Entra ID and separate authorization—can set that state without asking the agent to cooperate.

If Durable Functions is orchestrating the workflow, its management API can suspend or terminate the orchestration by instance ID.

But here is an important limitation: terminating an orchestration does not automatically cancel activity functions already running. So we propagate cancellation where the downstream service supports it, use deadlines and idempotency keys, and track anything that may still complete.

*Stop the rotor and disconnect the credentials.*

Then we remove authority. We remove the agent’s RBAC assignments or disable the relevant principal, invalidate unused approvals, and block calls at the tool gateway.

Token revocation may not be instantaneous because already-issued access tokens have a lifetime. That is why the tool boundary also checks the durable stop state.

Killing the process while leaving its authority alive is like taking someone’s car keys and leaving the spare under the mat.

*Settle records and notify the owner.*

Finally, we reconcile in-flight actions against the ledger, record what finished and what is unknown, alert the owner, and keep the stop state across restarts. Recovery requires a human decision and fresh credentials.

A kill switch cannot unsend an email or undo every refund. It limits what happens next.

The best test is direct: in staging, stop the agent halfway through a real tool call.

If it resumes on reboot, keeps using its tools, or leaves us unable to tell what completed, we do not have a kill switch.

We have a pause button with confidence issues.

---

## Close — One agent, six boundaries (about 1¼ minutes)

*Return to the room list or introduction.*

So, that is Northstar’s agent—and that is the house.

Foundry and Entra give the agent a real identity.

Foundry evaluations and Application Insights give us evidence about reliability.

Agent Framework can pause a dangerous tool for human approval, while our API enforces the exact one-use decision.

Our runtime policy catches ambiguity and Durable Functions can hold the state while we ask.

Application Insights traces the journey, and a protected event store or Confidential Ledger preserves the critical receipts.

Azure Monitor, API Management, Entra, and the workflow control plane help us stop the system and remove its authority.

Notice that no single product owns the whole answer. That is the point.

Governance is architecture. It is the identity on the call, the test in the pipeline, the check before the tool, the receipt around the side effect, and the stop path we have actually rehearsed.

We still need privacy, security, fairness, legal review, and—occasionally—the courage not to automate something.

But now “responsible AI” is no longer just a nice sentence on a slide. It is engineering work we can point to, test, and improve.

The model can suggest an action.

Our system decides whether that action has a name, proof, permission, clarity, a receipt, and a working off switch.

Because the next agent could be ours.

And if it is, the consequences could be somebody else’s.

*Pause. Advance to the “Thank you” cover. Leave the QR code for chienda.com/speaking on screen.*

---

## Rehearsal notes

- Say “Microsoft Foundry” on first mention. After that, “Foundry” sounds more natural.
- Do not recite every service name with equal emphasis. The safeguard is the main character; Azure is the concrete implementation.
- Pause before each limitation—especially “identity is not permission,” “evaluation does not replace software testing,” and “termination does not cancel work already running.” Those lines build trust.
- If you need to shorten the talk, cut product-detail sentences from each room, but keep the Northstar example and the implementation summary.
- Add one genuine example from your own experience if possible. A shared service account, a demo broken by an edge case, or an ambiguous customer record will make the talk unmistakably yours.

## Implementation references

- [What is Microsoft Foundry?](https://learn.microsoft.com/en-us/azure/ai-foundry/what-is-ai-foundry)
- [Microsoft Foundry Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/overview)
- [Agent identity concepts in Microsoft Foundry](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/agent-identity)
- [Evaluate generative AI applications in Foundry](https://learn.microsoft.com/en-us/azure/foundry/how-to/evaluate-generative-ai-app)
- [Monitor agents in Foundry](https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard)
- [Use function tools with human approval](https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval)
- [Handle external events in Durable Functions](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-external-events)
- [Manage Durable Functions orchestration instances](https://learn.microsoft.com/en-gb/azure/azure-functions/durable/durable-functions-instance-management)
- [Azure API Management token limits](https://learn.microsoft.com/en-us/azure/api-management/llm-token-limit-policy)
- [Azure Confidential Ledger overview](https://learn.microsoft.com/en-us/azure/confidential-ledger/overview)
