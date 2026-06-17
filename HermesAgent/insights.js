// Derives the "learning & evolution" picture for an agent from its persisted
// conversation log. Everything here is honest and grounded in the real log:
//   - turns/actions    : how much the agent has actually done
//   - skills exercised : which tools it has invoked, and how often (competence)
//   - focus areas      : recurring topics in what it's been asked (specialization)
//   - timeline         : notable moments (first contact, tool actions, latest)
// No fabricated "the AI got smarter" claims — just a readout of its track record.

const STOPWORDS = new Set(
  ("the a an and or but for to of in on at by with from into as is are was were be been being do does did " +
   "i you he she it we they me my your our their this that these those what which who whom how when where why " +
   "can could should would will shall may might must have has had not no yes please thanks thank just get got " +
   "make made list show tell give want need like about over under out up down off than then so if else also " +
   "hermes agent design designs product products one two new now today day s re ll ve m t don im its it's let's")
    .split(/\s+/),
);

// Humanize a tool name for display: printify_list_to_etsy -> "Printify list to etsy".
export function humanizeTool(name) {
  const s = String(name).replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function deriveInsights(log) {
  const messages = log?.messages ?? [];
  const userMsgs = messages.filter((m) => m.who === "you");
  const agentMsgs = messages.filter((m) => m.who === "agent");

  // Tool usage across every agent reply.
  const toolCounts = {};
  let actionsTaken = 0;
  for (const m of agentMsgs) {
    for (const a of m.actions ?? []) {
      toolCounts[a.tool] = (toolCounts[a.tool] || 0) + 1;
      actionsTaken += 1;
    }
  }
  const toolUsage = Object.entries(toolCounts)
    .map(([tool, count]) => ({ tool, label: humanizeTool(tool), count }))
    .sort((a, b) => b.count - a.count);

  // Focus areas: most frequent meaningful words in what the user asked.
  const wordCounts = {};
  for (const m of userMsgs) {
    for (const raw of String(m.text).toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
      const w = raw.replace(/^'+|'+$/g, "");
      if (w.length < 3 || STOPWORDS.has(w)) continue;
      wordCounts[w] = (wordCounts[w] || 0) + 1;
    }
  }
  const topics = Object.entries(wordCounts)
    .filter(([, n]) => n >= 1)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Timeline: first contact, notable tool actions, and the latest exchange.
  const milestones = [];
  if (messages.length) {
    milestones.push({ at: messages[0].at, kind: "start", text: "First contact established" });
  }
  for (const m of agentMsgs) {
    const ok = (m.actions ?? []).filter((a) => a.ok);
    if (ok.length) {
      milestones.push({
        at: m.at,
        kind: "action",
        text: `Ran ${ok.map((a) => humanizeTool(a.tool)).join(", ")}`,
      });
    }
  }
  // Keep the most recent handful, newest last.
  const trimmedMilestones = milestones.slice(-6);

  return {
    turns: userMsgs.length,
    exchanges: Math.min(userMsgs.length, agentMsgs.length),
    actionsTaken,
    distinctTools: toolUsage.length,
    toolUsage,
    topics,
    milestones: trimmedMilestones,
    createdAt: log?.createdAt ?? (messages[0]?.at ?? null),
    lastAt: messages.length ? messages[messages.length - 1].at : null,
  };
}
