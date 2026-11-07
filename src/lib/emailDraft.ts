import { OFFER } from "./config";

export const SENDER = {
  name: process.env.SENDER_NAME ?? "Abdul Hadi",
  company: "NBA INVESTMENTS LLC",
  phone: process.env.SENDER_PHONE ?? "",
  email: process.env.SENDER_EMAIL ?? "abdul@homebuyerssouthjersey.com",
};

const signature = () =>
  [SENDER.name, SENDER.company, "Cash & Hard Money Buyer | South Jersey", [SENDER.phone, SENDER.email].filter(Boolean).join(" | ")].join("\n");

const firstName = (full?: string | null) => {
  const f = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return f ? f[0].toUpperCase() + f.slice(1).toLowerCase() : "there";
};
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

// No assignment language here by design — assignability goes in the contract ("and/or assigns").
export function offerEmail(l: { address: string; city: string | null; mls_number: string; agent_name: string | null }, price: number) {
  return {
    subject: `Cash Offer - ${l.address}, ${l.city ?? ""} - MLS ${l.mls_number}`,
    body: `Hi ${firstName(l.agent_name)},

I'd like to submit an offer on ${l.address}${l.city ? `, ${l.city}` : ""} (MLS ${l.mls_number}):

- Purchase price: ${money(price)}
- Cash / hard money, no financing or appraisal contingency
- Close in ${OFFER.closeDays} days or as soon as title is clear
- Buyer purchasing in as-is condition

Proof of funds available on request. Please present to your seller and let me know if they'd like to counter.

Thank you,
${signature()}`,
  };
}

export function showingEmail(l: { address: string; city: string | null; mls_number: string; agent_name: string | null }) {
  return {
    subject: `Showing request - ${l.address} - MLS ${l.mls_number}`,
    body: `Hi ${firstName(l.agent_name)},

I'm a cash buyer interested in ${l.address}${l.city ? `, ${l.city}` : ""} (MLS ${l.mls_number}). The photos don't show much of the interior, so I'd like to see it in person before writing an offer.

Do you have any availability this week? I can close quickly with cash or hard money.

Thank you,
${signature()}`,
  };
}
