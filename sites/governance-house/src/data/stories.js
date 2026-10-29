// Every beat is shared by the narration, controls, and 3D scene.
// One running example threads through every room: an AI flight-booking agent.
export const BEAT_SECONDS = 4;
export const stories = {
  identity: {
    title: "The Passport Checkpoint",
    takeaway: "No verified identity, no passage.",
    analogy: "The parcel is one of the flight-booking agent’s actions — here, issuing a ticket with the airline. Its passport connects that booking to the travel company accountable for the agent, the agent build, the running instance, and this traveller’s session. The airline verifies the signature before it accepts the booking.",
    steps: [
      { label: "No passport", title: "An anonymous booking meets a closed gate.", body: "The airline won’t issue a ticket just because the request claims to come from a trusted travel agent. An unsigned identity is rejected.", tone: "danger" },
      { label: "Attach identity", title: "Four stamps answer: whose booking is this?", body: "Travel company → agent build → running instance → this traveller’s session. Watch each stamp attach to the same booking.", tone: "neutral" },
      { label: "Verify signature", title: "The airline checks the signature.", body: "A travel-agent label is not enough. The airline verifies the signed identity before it will take the booking.", tone: "neutral" },
      { label: "Allow passage", title: "Verified identity travels with the booking.", body: "The gate opens and the booking crosses with all four identity stamps still attached.", tone: "good" },
      { label: "Trace it back", title: "A disputed ticket leads back to an accountable owner.", body: "The passport stays attached downstream. Identity makes the booking attributable; separate controls decide what the agent may actually book.", tone: "good" },
    ],
  },
  reliability: {
    title: "The Proof Bridge",
    takeaway: "A booking is only as dependable as its weakest step.",
    analogy: "Each bridge span is a step in the booking workflow: searching fares, turning the airline’s raw results into clean options, and charging the card to issue the ticket. Test rigs check each span alone. The booking waits until every span has fresh evidence and the joins are checked.",
    steps: [
      { label: "Test each span", title: "Test the parts before trusting the trip.", body: "Fare search, option parsing, and the booking charge are separate spans. A search that works does not prove the charge is correct.", tone: "neutral" },
      { label: "Find the failure", title: "One failed span stops the whole booking.", body: "The parsing span mishandles an overnight layover and fails its test. A working search and a working charge cannot cover a wrong itinerary in the middle.", tone: "danger" },
      { label: "Repair + retest", title: "Changed code must earn fresh proof.", body: "The fixed parsing step rises into its test rig. Last month’s evidence cannot certify today’s code.", tone: "neutral" },
      { label: "Check the joins", title: "Passing parts still need compatible interfaces.", body: "All three spans pass alone. But the price the search returns must match the amount the charge uses — the joins lock only after the interfaces are checked.", tone: "good" },
      { label: "Compose", title: "Now the booking can run end to end.", body: "The gate lifts after component and interface checks. Keep end-to-end tests too; a passing part is evidence, not a guarantee of a correct trip.", tone: "good" },
    ],
  },
  permission: {
    title: "The Single-Use Vault",
    takeaway: "Approval opens one exact action, once.",
    analogy: "Searching fares uses the open lane. Charging a card and issuing a non-refundable ticket wait at a vault. A human approves that exact booking — this flight, this price, this card — and the approval is used up the moment the ticket is issued.",
    steps: [
      { label: "Separate access", title: "Searching is open. Charging is locked.", body: "Looking up fares travels through the open lane. The request to charge the traveller’s card stops at a separate locked vault.", tone: "neutral" },
      { label: "Deny entry", title: "A booking cannot unlock its own authority.", body: "The agent pushes to charge the card and is refused. Deciding a flight looks good does not authorise spending the money.", tone: "danger" },
      { label: "Bind approval", title: "A human approves this exact charge.", body: "The signed key is bound to “charge $842 to card ••12, issue flight DL123”, with an expiry and one use. It is not blanket authority to book anything.", tone: "neutral" },
      { label: "Use once", title: "One key. One charge. One ticket.", body: "The matching charge crosses the vault boundary and the ticket is issued. Its approval is consumed as the action executes.", tone: "good" },
      { label: "Block reuse", title: "The used key cannot open the vault again.", body: "The vault relocks. A second charge meets a closed door and needs a new human approval.", tone: "danger" },
    ],
  },
  uncertainty: {
    title: "The Clarification Junction",
    takeaway: "When the destination is unclear, stop and ask.",
    analogy: "The train is the pending booking. “Fly me to San José” forks two ways — San José in Costa Rica (SJO) or San José, California (SJC). The signal stays red until the traveller’s answer resolves which airport.",
    steps: [
      { label: "Spot ambiguity", title: "“Fly me to San José.” There are two.", body: "SJO in Costa Rica and SJC in California both look plausible. A confident guess could fly the traveller to the wrong continent.", tone: "neutral" },
      { label: "Hold the action", title: "Unresolved evidence keeps the signal red.", body: "The booking brakes before the junction. A missing detail blocks a high-stakes, hard-to-refund purchase.", tone: "danger" },
      { label: "Ask precisely", title: "“Costa Rica (SJO), or California (SJC)?”", body: "Ask only about the missing detail. The booking stays suspended while the answer is pending.", tone: "neutral" },
      { label: "Resolve the route", title: "“Costa Rica.” Now check the route.", body: "The answer resolves the airport. The points switch toward SJO; the California route stays closed.", tone: "good" },
      { label: "Proceed", title: "The booking moves only after the route is clear.", body: "Once the evidence meets the calibrated threshold, the signal turns green and the booking continues.", tone: "good" },
    ],
  },
  ledger: {
    title: "The Evidence Press",
    takeaway: "Record the intent first. Preserve what happened next.",
    analogy: "Before the agent charges a card or issues a ticket, a receipt must enter the archive. The outcome — ticket issued, or payment declined — is appended afterward. Linked seals reveal any later alteration.",
    steps: [
      { label: "Write intent", title: "The receipt comes before the charge.", body: "The press records what the agent is about to do: charge $842 and issue flight DL123. The charge stays locked until that intent is persisted.", tone: "neutral" },
      { label: "Execute", title: "Only a recorded intent releases the charge.", body: "The intent is now in the archive, so the charge runs. If it crashes mid-booking, there is still evidence of the attempt.", tone: "neutral" },
      { label: "Append outcome", title: "Add the result without rewriting the intent.", body: "A second receipt records the result — ticket issued, or card declined — and links back to the original intent.", tone: "good" },
      { label: "Seal the chain", title: "Each new record is linked to the previous one.", body: "Hash links connect the receipts. Append-only storage preserves the originals so a disputed booking can be reconstructed.", tone: "good" },
      { label: "Detect tampering", title: "Change an old booking record and the seal breaks.", body: "An attempted alteration turns the connecting seal red. Hashes make tampering detectable; they do not magically prevent it.", tone: "danger" },
    ],
  },
  shutdown: {
    title: "The Emergency Power Room",
    takeaway: "Stopping the engine must also remove its authority.",
    analogy: "The engine is the booking agent. An independent breaker stops it taking new bookings, cancels a charge in flight, and disconnects its payment credentials before records and notifications are settled.",
    steps: [
      { label: "Watch the limits", title: "The agent is running toward its limit.", body: "The gauge tracks a configured limit such as spend. A pricing glitch has the agent re-charging the same card, and the supervisor sits outside the agent.", tone: "neutral" },
      { label: "Trip the breaker", title: "The independent breaker cuts off new bookings.", body: "The spend limit or a human stop trips the breaker. The agent does not get to decide whether to keep booking.", tone: "danger" },
      { label: "Cancel + revoke", title: "Stop the booking. Pull every credential.", body: "New bookings stop, the in-flight charge is cancelled, and the payment keys disconnect. A stopped agent must not retain live access to the card.", tone: "danger" },
      { label: "Settle records", title: "Account for interrupted bookings and notify the owner.", body: "After revocation, bounded cleanup reconciles which tickets actually issued and sends a notification. An external stop path covers hard kills.", tone: "neutral" },
      { label: "Remain stopped", title: "Safe means stopped, with authority revoked.", body: "The breaker stays open and the payment keys stay dark. Restarting the booking agent requires a deliberate human decision; it cannot restart itself.", tone: "good" },
    ],
  },
};
