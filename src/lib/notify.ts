// Phone push via ntfy (subscribe to NTFY_TOPIC in the ntfy app).
export async function push(title: string, message: string, opts: { url?: string; priority?: 3 | 4 | 5; tags?: string } = {}) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    body: message,
    headers: {
      Title: title.replace(/[^\x20-\x7E]/g, ""),
      Priority: String(opts.priority ?? 4),
      ...(opts.tags ? { Tags: opts.tags } : {}),
      ...(opts.url ? { Click: opts.url } : {}),
    },
  });
}

export function proofOfFundsAlert(p: { address: string; agentName: string; agentEmail: string }) {
  return push(
    `POF requested: ${p.address}`,
    `Agent: ${p.agentName}\nSend proof of funds to: ${p.agentEmail}`,
    { priority: 5, tags: "moneybag" },
  );
}
