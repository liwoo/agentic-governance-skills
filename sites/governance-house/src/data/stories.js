// Every beat is shared by the narration, controls, and 3D scene.
export const BEAT_SECONDS = 4;
export const stories = {
  identity: {
    title: "The Passport Checkpoint",
    takeaway: "No verified identity, no passage.",
    analogy: "The parcel is an action. Its passport connects that action to an owner, agent, running instance, and session. The checkpoint verifies the signature.",
    steps: [
      { label: "No passport", title: "An anonymous action meets a closed gate.", body: "The parcel cannot leave just because it claims to be trustworthy. An unsigned identity is rejected.", tone: "danger" },
      { label: "Attach identity", title: "Four stamps answer: whose action is this?", body: "Owner → agent → instance → session. Watch each stamp attach to the same parcel.", tone: "neutral" },
      { label: "Verify signature", title: "The checkpoint checks the signature.", body: "Having a label is not enough. The service verifies the signed identity before opening the gate.", tone: "neutral" },
      { label: "Allow passage", title: "Verified identity travels with the action.", body: "The gate opens and the parcel crosses with all four identity stamps still attached.", tone: "good" },
      { label: "Trace it back", title: "Every action leads back to an accountable owner.", body: "The passport stays attached downstream. Identity makes the action attributable; separate controls decide what it may do.", tone: "good" },
    ],
  },
  reliability: {
    title: "The Proof Bridge",
    takeaway: "A workflow is only as dependable as its weakest step.",
    analogy: "Each bridge span is a subtask. Test rigs evaluate the spans separately. The workflow waits until every span has fresh evidence and the joins are checked.",
    steps: [
      { label: "Test each span", title: "Test the parts before trusting the journey.", body: "Retrieval, transformation, and action are separate spans. Each needs its own evaluation evidence.", tone: "neutral" },
      { label: "Find the failure", title: "One failed span stops the whole workflow.", body: "The middle span fails its test and drops away. Two passing components cannot cover the gap.", tone: "danger" },
      { label: "Repair + retest", title: "A changed component must earn fresh proof.", body: "The repaired span rises into its test rig. An old certificate cannot certify new code.", tone: "neutral" },
      { label: "Check the joins", title: "Passing parts still need compatible interfaces.", body: "All three spans now pass. The connecting pins lock only after the interfaces are checked.", tone: "good" },
      { label: "Compose", title: "Now the workflow can cross.", body: "The gate lifts after component and interface checks. Keep end-to-end tests too; certificates are evidence, not a guarantee of perfection.", tone: "good" },
    ],
  },
  permission: {
    title: "The Single-Use Vault",
    takeaway: "Approval opens one exact action, once.",
    analogy: "Ordinary tools use the open lane. A consequential action waits at a vault. A human issues a key for that exact action, and the key is consumed on use.",
    steps: [
      { label: "Separate access", title: "Reading is open. Deleting is locked.", body: "The ordinary read travels through the open lane. The delete request stops at a separate locked vault.", tone: "neutral" },
      { label: "Deny entry", title: "A request cannot unlock its own authority.", body: "The agent pushes at the vault and is refused. Asking for a dangerous tool does not grant access to it.", tone: "danger" },
      { label: "Bind approval", title: "A human approves this exact request.", body: "The signed key is bound to “delete draft-7”, with an expiry and one use. It is not a master key.", tone: "neutral" },
      { label: "Use once", title: "One key. One action. One opening.", body: "The matching request crosses the vault boundary. Its approval is consumed as the action executes.", tone: "good" },
      { label: "Block reuse", title: "The used key cannot open the vault again.", body: "The vault relocks. A second request meets a closed door and needs a new human approval.", tone: "danger" },
    ],
  },
  uncertainty: {
    title: "The Clarification Junction",
    takeaway: "When the destination is unclear, stop and ask.",
    analogy: "The train is a pending action. Two plausible destinations create a fork. The signal stays red until evidence from a targeted answer resolves the route.",
    steps: [
      { label: "Spot ambiguity", title: "“Send it to Alex.” There are two Alexes.", body: "Both tracks look plausible. Fluency or a confident guess cannot identify the intended recipient.", tone: "neutral" },
      { label: "Hold the action", title: "Unresolved evidence keeps the signal red.", body: "The train brakes before the junction. Missing or conflicting signals block a high-stakes action.", tone: "danger" },
      { label: "Ask precisely", title: "“Alex in Design, or Alex in Finance?”", body: "Ask about the missing detail. The action remains suspended while the answer is pending.", tone: "neutral" },
      { label: "Resolve the route", title: "“Alex in Design.” Now check the route.", body: "The answer resolves the recipient. The points switch toward Design; the other route stays closed.", tone: "good" },
      { label: "Proceed", title: "The train moves only after the route is clear.", body: "Once the evidence meets the calibrated threshold, the signal turns green and the action continues.", tone: "good" },
    ],
  },
  ledger: {
    title: "The Evidence Press",
    takeaway: "Record the intent first. Preserve what happened next.",
    analogy: "A receipt must enter the archive before the action machine can run. Its outcome is appended afterward. Linked seals reveal any later alteration.",
    steps: [
      { label: "Write intent", title: "The receipt comes before the action.", body: "The press records what the agent is about to do. The action machine stays locked until that intent is persisted.", tone: "neutral" },
      { label: "Execute", title: "Only a recorded intent releases the action.", body: "The intent is now in the archive, so the machine runs. If execution crashes, there is still evidence of the attempt.", tone: "neutral" },
      { label: "Append outcome", title: "Add the result without rewriting the intent.", body: "A second receipt records success or failure and links back to the original intent.", tone: "good" },
      { label: "Seal the chain", title: "Each new record is linked to the previous one.", body: "Hash links connect the receipts. Append-only storage preserves the originals; verification checks the chain.", tone: "good" },
      { label: "Detect tampering", title: "Change an old record and the seal breaks.", body: "An attempted alteration turns the connecting seal red. Hashes make tampering detectable; they do not magically prevent it.", tone: "danger" },
    ],
  },
  shutdown: {
    title: "The Emergency Power Room",
    takeaway: "Stopping the engine must also remove its authority.",
    analogy: "The engine is the agent. An independent breaker stops new work, cancels work in flight, and disconnects its credential rack before records and notifications are settled.",
    steps: [
      { label: "Watch the limits", title: "The engine is running toward its limit.", body: "The gauge tracks a configured limit such as spend, steps, or errors. The supervisor sits outside the engine.", tone: "neutral" },
      { label: "Trip the breaker", title: "The independent breaker cuts off new work.", body: "A limit or a human stop trips the breaker. The agent does not get to decide whether to cooperate.", tone: "danger" },
      { label: "Cancel + revoke", title: "Stop the work. Pull every credential.", body: "The rotor stops, pending work is cancelled, and the keys disconnect. A stopped process must not retain live authority.", tone: "danger" },
      { label: "Settle records", title: "Account for interrupted work and notify the owner.", body: "After revocation, bounded cleanup flushes the ledger and sends a notification. An external revocation path covers hard kills.", tone: "neutral" },
      { label: "Remain stopped", title: "Safe means stopped, with authority revoked.", body: "The breaker stays open and the keys stay dark. Recovery requires a deliberate operational decision; the agent cannot restart itself.", tone: "good" },
    ],
  },
};
