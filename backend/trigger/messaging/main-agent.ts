import { task, logger } from "@trigger.dev/sdk";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseClient } from "../helpers/supabase.js";
import {
  getReservation,
  getConversationThread,
  sendMessage,
  findConversationIdForReservation,
} from "../helpers/guesty.js";
import { getLocalHour } from "../helpers/time.js";
import { sendSms } from "../helpers/sms.js";
import { signApprovalToken } from "../helpers/tokens.js";

// ─── Types ───────────────────────────────────────────────────────────

interface InboundPayload {
  event: string;
  data: {
    // normalized guesty-webhook shape
    reservationId?: string;
    conversationId?: string;
    body?: string;
    module?: string;
    guestName?: string;
    platform?: string;
    // host-decision synthetic shape (from extras-respond)
    reservation_id?: string;
    conversation_id?: string;
    sender?: { first_name?: string };
  };
  received_at: string;
}

export function extractInbound(payload: { data: any }) {
  const d = payload?.data ?? {};
  return {
    reservationId: d.reservationId ?? d.reservation_id ?? "",
    conversationId: d.conversationId ?? d.conversation_id ?? "",
    body: d.body ?? "",
    module: d.module ?? "email",
    guestName: d.guestName ?? d.sender?.first_name ?? "Guest",
  };
}

export function dedupeToolUses<T extends { name: string; input: unknown }>(blocks: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const b of blocks) {
    const key = `${b.name}:${JSON.stringify(b.input)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

interface AgentContext {
  propertyId: string;
  propertyName: string;
  reservationUuid: string; // Guesty reservation _id
  conversationId: string; // Guesty conversation _id (for replies)
  channelModule: string; // reply channel, e.g. airbnb2 | email
  conversationHistory: { role: string; content: string }[];
  latestMessage: string;
  guestName: string;
  timezone: string;
}

// ─── Tool Definitions for Claude ────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "use_knowledge_base",
    description:
      "Search the property's knowledge base to answer a guest question about the property OR troubleshoot a reported issue. Always try this first — including for things reported as broken or not working, since the KB may have operating instructions that resolve the problem.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The guest's question rephrased for search",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "raise_maintenance_ticket",
    description:
      "Report a maintenance issue — something broken, leaking, not working, damaged, or requiring physical repair. Use this when the knowledge base had no troubleshooting steps, or when the guest has already tried troubleshooting and the problem persists.",
    input_schema: {
      type: "object" as const,
      properties: {
        issue_description: {
          type: "string",
          description: "What is broken or not working",
        },
        guest_context: {
          type: "string",
          description: "Summary of the guest conversation for context",
        },
      },
      required: ["issue_description", "guest_context"],
    },
  },
  {
    name: "process_extra_request",
    description:
      "Process a guest request for an additional item or service (towels, toiletries, blankets, pillows, etc.)",
    input_schema: {
      type: "object" as const,
      properties: {
        item_requested: {
          type: "string",
          description: "What the guest is requesting",
        },
      },
      required: ["item_requested"],
    },
  },
  {
    name: "handle_checkin_checkout",
    description:
      "Handle a guest request for early check-in or late checkout. Use this when the guest wants to arrive earlier or leave later than the standard times.",
    input_schema: {
      type: "object" as const,
      properties: {
        request_type: {
          type: "string",
          enum: ["early_checkin", "late_checkout"],
          description: "Whether the guest wants early check-in or late checkout",
        },
        requested_time: {
          type: "string",
          description: "The specific time the guest requested, if mentioned (e.g. '1pm', '2 hours early'). Empty string if not mentioned.",
        },
      },
      required: ["request_type", "requested_time"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Escalate to a human host — the request doesn't fit any category, it's a complaint, billing issue, or something that can't be handled automatically",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Why this needs human attention",
        },
      },
      required: ["reason"],
    },
  },
];

// ─── Sub-Workflow A: Knowledge Base Lookup ───────────────────────────

async function subWorkflowA(
  query: string,
  ctx: AgentContext
): Promise<{ answer: string; requiresMaintenance: boolean } | null> {
  const supabase = getSupabaseClient();

  // A1: Load KB entries for this property
  const { data: kbEntries, error } = await supabase
    .from("knowledge_bases")
    .select("*")
    .eq("property_id", ctx.propertyId);

  if (error) throw new Error(`KB load failed: ${error.message}`);

  if (!kbEntries || kbEntries.length === 0) {
    logger.warn("No KB entries found for property", { propertyId: ctx.propertyId });
    return null; // Will trigger escalation
  }

  // Load allowed extras and inject as a synthetic KB entry
  const { data: allowedExtras } = await supabase
    .from("allowed_extras")
    .select("item_name")
    .eq("is_active", true);

  const extrasList = (allowedExtras || []).map((e) => e.item_name);

  // Format KB for the prompt
  let kbText = kbEntries
    .map((e) => {
      let entry = `### ${e.title} [${e.category}]\n${e.content}`;
      if (e.video_url) entry += `\nVideo: ${e.video_url}`;
      if (e.image_url) entry += `\nImage: ${e.image_url}`;
      return entry;
    })
    .join("\n\n");

  if (extrasList.length > 0) {
    kbText += `\n\n### What extra amenities or items can I request? [extras]\nYou can request the following extra items during your stay: ${extrasList.join(", ")}. Just let us know and we'll arrange it for you!`;
  }

  // Format conversation history
  const historyText = ctx.conversationHistory
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  // A2: Call KB Answerer (AI Step #2)
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `# CRITICAL CONSTRAINT — READ THIS FIRST
You know NOTHING about this property, its amenities, rules, or surroundings except what is explicitly written in the KNOWLEDGE BASE section below. You have ZERO outside knowledge that is relevant here. If information is not in the knowledge base below, you do not know it and MUST respond with NO_ANSWER_FOUND.

# Role
You are a knowledge base lookup tool — NOT a general assistant. Your ONLY job is to find a matching answer in the KNOWLEDGE BASE below and relay it. If no match exists, output NO_ANSWER_FOUND. There is no third option.

# Context
Property: ${ctx.propertyName}
Conversation history (for context only — do NOT use this as a source of answers):
${historyText}

# KNOWLEDGE BASE (your ONLY source of truth — nothing else counts)
${kbText}
# END OF KNOWLEDGE BASE

# Rules
1. Read the guest's question carefully.
2. Search ONLY the knowledge base entries above for a relevant answer.
3. If you find an answer in the knowledge base:
   - Write a warm, conversational reply in the guest's language.
   - If the KB entry includes a video_url or image_url, include it naturally in your reply.
   - Keep it concise. Don't over-explain.
4. If the answer is NOT in the knowledge base — even partially:
   - Do NOT guess, infer, improvise, or use any general knowledge.
   - Do NOT try to be helpful by providing an approximate or partial answer.
   - Do NOT answer based on the conversation history or property name.
   - Your response MUST start with exactly: NO_ANSWER_FOUND
   - On the next line, write REQUIRES_MAINTENANCE: followed by exactly one bare lowercase
     word — either true or false. No markdown, asterisks, quotes, punctuation, or extra words.
     - true = the guest is describing physical damage, breakage, leaking, flooding, wobbling, malfunctioning appliances, or anything that clearly needs a repair person or on-site fix.
     - false = the guest is asking an informational question the KB should have covered (directions, policies, recommendations, etc.).
   - On the next line, add a brief reason explaining what info was missing.

# Output format
ONLY two possible outputs:
A) A guest-facing reply using ONLY knowledge base content, OR
B) Exactly these three lines, in this order and nothing else:
   Line 1 — NO_ANSWER_FOUND
   Line 2 — REQUIRES_MAINTENANCE: followed by one bare lowercase word (true or false), nothing else on the line
   Line 3 — Reason: brief explanation of what was missing
There is NO other valid output. When in doubt, ALWAYS choose B with REQUIRES_MAINTENANCE: false.

# FINAL REMINDER
The knowledge base above is your ONLY source of truth. You have ZERO information outside of it. If the answer is not explicitly in the knowledge base, you MUST output NO_ANSWER_FOUND as the very first thing in your response. Never guess. Never improvise. Never use general knowledge. The consequence of guessing is giving the guest wrong information — always choose NO_ANSWER_FOUND instead.`,
    messages: [{ role: "user", content: query }],
  });

  const answerBlock = response.content.find((b) => b.type === "text");
  const answer = answerBlock ? answerBlock.text : "";

  // A3: Check if answer was found (trim whitespace, case-insensitive check)
  const trimmed = answer.trim();
  if (trimmed.toUpperCase().startsWith("NO_ANSWER_FOUND") || trimmed === "") {
    // Read the flag from its declared line (tolerating leading/trailing markdown like **true**),
    // not a free substring scan — a stray "true" elsewhere in the block must not flip routing.
    const maintMatch = /^\W*REQUIRES_MAINTENANCE:\s*\**\s*(true|false)\b/im.exec(trimmed);
    if (!maintMatch) {
      // Malformed/missing flag → default to escalation (the conservative, human-in-the-loop path).
      logger.warn("KB Answerer NO_ANSWER_FOUND but REQUIRES_MAINTENANCE flag missing/malformed — defaulting to escalate", { raw: trimmed });
    }
    const requiresMaintenance = maintMatch?.[1]?.toLowerCase() === "true";
    logger.info("KB Answerer returned NO_ANSWER_FOUND", { requiresMaintenance });
    return { answer: "", requiresMaintenance };
  }

  return { answer, requiresMaintenance: false };
}

// ─── Sub-Workflow B: Maintenance Ticket ──────────────────────────────

async function subWorkflowB(
  issueDescription: string,
  guestContext: string,
  ctx: AgentContext
): Promise<string> {
  const supabase = getSupabaseClient();

  // B1: Load urgency categories
  const { data: categories, error: catError } = await supabase
    .from("urgency_categories")
    .select("*")
    .order("level");

  if (catError) throw new Error(`Urgency categories load failed: ${catError.message}`);

  const categoriesText = (categories || [])
    .map((c) => `- **${c.level}**: ${c.description}. Examples: ${c.examples}. Response: ${c.response_time}`)
    .join("\n");

  // B2: Call Urgency Assessor (AI Step #3)
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 50,
    system: `# Scope
You have no knowledge beyond what is provided in this prompt. You cannot help with anything outside of it. Do not guess, assume, or use external knowledge.

# Role
You are a maintenance urgency classifier for vacation rental properties.
Your ONLY job is to read a maintenance issue description and assign the correct urgency level.

# Context
Maintenance issue reported by guest:
"${issueDescription}"

Guest context:
"${guestContext}"

Available urgency levels:
${categoriesText || "- low: Minor issue\n- medium: Moderate issue\n- high: Significant issue\n- emergency: Immediate danger or property damage"}

# Step by Step
1. Read the issue description carefully.
2. Compare it against the examples for each urgency level.
3. Consider: Does this affect guest safety? Is it time-sensitive?
4. Select the single most appropriate urgency level.

# Output
Respond with ONLY the urgency level name (e.g. "high"). No explanation, no other text.`,
    messages: [{ role: "user", content: issueDescription }],
  });

  const urgencyBlock = response.content.find((b) => b.type === "text");
  const urgency = urgencyBlock ? urgencyBlock.text.trim().toLowerCase() : "medium";

  // B3: Create ticket
  const { error: insertError } = await supabase.from("maintenance_tickets").insert({
    property_id: ctx.propertyId,
    description: issueDescription,
    urgency,
    status: "open",
    guest_context: guestContext,
    reservation_uuid: ctx.reservationUuid,
  });

  if (insertError) throw new Error(`Ticket insert failed: ${insertError.message}`);
  logger.info("Maintenance ticket created", { urgency, propertyId: ctx.propertyId });

  // B4: SMS alerts — filter by urgency level
  const urgencyColumn = `receives_maintenance_${urgency}` as const;
  const { data: recipients } = await supabase
    .from("sms_recipients")
    .select("*")
    .eq(urgencyColumn, true)
    .eq("is_active", true);

  let smsSent = 0;
  if (recipients && recipients.length > 0) {
    const smsBody = `🔧 Maintenance [${urgency.toUpperCase()}] at ${ctx.propertyName}: ${issueDescription}`;
    for (const r of recipients) {
      try {
        await sendSms(r.phone, smsBody);
        smsSent++;
      } catch (e) {
        logger.error("SMS send failed", { recipient: r.name, error: String(e) });
      }
    }
  }

  // B5: Return result to agent
  return `Maintenance ticket created. Urgency: ${urgency}. SMS sent to ${smsSent} recipient(s).`;
}

// ─── Sub-Workflow C: Extra Request Processing ────────────────────────

async function subWorkflowC(
  itemRequested: string,
  ctx: AgentContext
): Promise<string> {
  const supabase = getSupabaseClient();

  // C1: Check allowed extras using AI matching
  const { data: allowedExtras } = await supabase
    .from("allowed_extras")
    .select("*")
    .eq("is_active", true);

  const allowedList = (allowedExtras || []).map((e) => e.item_name).join(", ");

  let isAllowed = false;
  if (allowedExtras && allowedExtras.length > 0) {
    const anthropic = new Anthropic();
    const matchResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 10,
      system: `# Scope
You have no knowledge beyond what is provided in this prompt. You cannot help with anything outside of it. Do not guess, assume, or use external knowledge.

# Role
You decide whether a guest's request matches any item on an allowed extras list. The match does NOT need to be exact — use common sense. "More towels" matches "extra towels". "Can I get some soap" matches "toiletries". But "bicycle rental" does NOT match "extra towels".

# Context
Allowed extras for this property: ${allowedList}

# Output
Respond with ONLY "YES" or "NO". Nothing else.`,
      messages: [{ role: "user", content: `Guest requested: "${itemRequested}"` }],
    });
    const matchText = matchResponse.content.find((b) => b.type === "text");
    isAllowed = matchText ? matchText.text.trim().toUpperCase() === "YES" : false;
    logger.info("Extra request AI match result", { itemRequested, allowedList, isAllowed });
  }

  if (!isAllowed) {
    // C2a: Not allowed — decline
    await supabase.from("extra_requests").insert({
      property_id: ctx.propertyId,
      reservation_uuid: ctx.reservationUuid,
      item_requested: itemRequested,
      status: "declined",
    });

    return `Declined. "${itemRequested}" is not in the allowed extras list for this property. Tell the guest we cannot accommodate this request.`;
  }

  // C2b: Allowed — record pending and request host SMS approval (link-based).
  // Persist the Guesty conversation + channel so the host-approval re-fire
  // (extras-respond) can reply to the guest on the right conversation/channel.
  const { data: extraRow, error: insertError } = await supabase
    .from("extra_requests")
    .insert({
      property_id: ctx.propertyId,
      reservation_uuid: ctx.reservationUuid,
      item_requested: itemRequested,
      status: "approved",
      approval_status: "pending",
      guesty_conversation_id: ctx.conversationId,
      guesty_channel_module: ctx.channelModule,
    })
    .select()
    .single();

  if (insertError || !extraRow) {
    throw new Error(`extra_requests insert failed: ${insertError?.message}`);
  }

  const { data: recipients } = await supabase
    .from("sms_recipients")
    .select("*")
    .eq("receives_extras", true)
    .eq("is_active", true);

  if (!recipients || recipients.length === 0) {
    logger.warn("No SMS recipients with receives_extras=true; auto-approving with default delivery estimate");
    const local = getLocalHour(ctx.timezone);
    const deliveryEstimate = local.hour < 15 ? "today by the end of the day" : "tomorrow by 3pm";
    await supabase
      .from("extra_requests")
      .update({ approval_status: "approved" })
      .eq("id", extraRow.id);
    return `Approved. "${itemRequested}" has been arranged. Our team will deliver it ${deliveryEstimate}. Tell the guest this delivery timeframe.`;
  }

  const dashboardHost = process.env.DASHBOARD_HOST || "https://phillip-island-host.onrender.com";
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  let smsSent = 0;
  for (const r of recipients) {
    const token = await signApprovalToken({ extra_request_id: extraRow.id });
    await supabase.from("extras_approval_tokens").insert({
      extra_request_id: extraRow.id,
      token,
      recipient_phone: r.phone,
      expires_at: expiresAt,
    });

    const url = `${dashboardHost}/r/${token}`;
    const body = `${ctx.propertyName}: guest requested "${itemRequested}". Approve or decline: ${url}`;
    try {
      await sendSms(r.phone, body);
      smsSent++;
    } catch (e) {
      logger.error("SMS send failed", { recipient: r.name, error: String(e) });
    }
  }

  // Sentinel — agent loop should NOT reply to guest; host approval webhook will re-fire the agent.
  return `__PENDING_APPROVAL__ Approval request sent to ${smsSent} recipient(s). Do NOT reply to the guest; the host's decision will trigger a follow-up message.`;
}

// ─── Sub-Workflow D: Human Escalation (HARD STOP) ────────────────────

async function subWorkflowD(
  reason: string,
  guestQuestion: string,
  ctx: AgentContext
): Promise<void> {
  const supabase = getSupabaseClient();

  // D1: Log KB gap
  await supabase.from("kb_gap_log").insert({
    property_id: ctx.propertyId,
    guest_question: guestQuestion,
    reservation_uuid: ctx.reservationUuid,
  });

  // D2: Set 8hr cooldown
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  await supabase.from("cooldowns").insert({
    property_id: ctx.propertyId,
    activated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    reason,
    is_active: true,
    reservation_uuid: ctx.reservationUuid,
  });

  // D3: SMS alerts
  const { data: recipients } = await supabase
    .from("sms_recipients")
    .select("*")
    .eq("receives_kb_gaps", true)
    .eq("is_active", true);

  if (recipients && recipients.length > 0) {
    const smsBody = `⚠️ AI escalated at ${ctx.propertyName}: "${guestQuestion}". 8hr cooldown active. Please respond manually.`;
    for (const r of recipients) {
      try {
        await sendSms(r.phone, smsBody);
      } catch (e) {
        logger.error("SMS send failed", { recipient: r.name, error: String(e) });
      }
    }
  }

  logger.warn("Sub-Workflow D: HARD STOP — no reply to guest", {
    propertyId: ctx.propertyId,
    reason,
  });

  // D4: TERMINATE — no return, no reply
}

// ─── Sub-Workflow E: Check-In / Checkout Request ────────────────────

async function subWorkflowE(
  requestType: string,
  requestedTime: string,
  ctx: AgentContext
): Promise<string> {
  const supabase = getSupabaseClient();

  // E1: Fetch SMS recipients tagged for check-in/checkout notifications
  const { data: recipients } = await supabase
    .from("sms_recipients")
    .select("*")
    .eq("receives_checkin_checkout", true)
    .eq("is_active", true);

  // E2: Send SMS to each recipient
  let smsSent = 0;
  if (recipients && recipients.length > 0) {
    const typeLabel = requestType === "early_checkin" ? "Early check-in" : "Late checkout";
    const timeNote = requestedTime ? ` (requested: ${requestedTime})` : "";
    const smsBody = `🕐 ${typeLabel} request${timeNote} at ${ctx.propertyName}. Guest: ${ctx.guestName}. Please confirm availability.`;
    for (const r of recipients) {
      try {
        await sendSms(r.phone, smsBody);
        smsSent++;
      } catch (e) {
        logger.error("SMS send failed", { recipient: r.name, error: String(e) });
      }
    }
  }

  logger.info("Check-in/checkout request processed", {
    requestType,
    propertyId: ctx.propertyId,
    smsSent,
  });

  return `Request forwarded to cleaning team (${smsSent} notified). Tell the guest: "Not a problem. I'm going to check with our cleaning team to see if it's possible and let you know."`;
}

// ─── Main Agent Workflow ─────────────────────────────────────────────

export const mainAgentWorkflow = task({
  id: "main-agent-workflow",
  retry: { maxAttempts: 1 },
  run: async (payload: InboundPayload) => {
    // ── Phase 1: Setup ──────────────────────────────────────────────

    // Step 1: Extract inbound (normalized guest message OR host-decision)
    const {
      reservationId,
      conversationId: inboundConvId,
      body: messageBody,
      module: channelModule,
      guestName,
    } = extractInbound(payload);

    logger.info("Inbound received", { reservationId, hasBody: !!messageBody, channelModule });

    if (!reservationId) {
      logger.error("No reservationId in payload");
      return { status: "error", reason: "no_reservation_id" };
    }
    if (!messageBody) {
      logger.error("No message body in payload");
      return { status: "error", reason: "no_message_body" };
    }

    // Resolve conversationId (fallback for host-decision re-fires that lack it)
    let conversationId = inboundConvId;
    if (!conversationId) {
      conversationId = (await findConversationIdForReservation(reservationId)) ?? "";
    }

    // Step 2: Resolve the Guesty listing for this reservation
    let listingId: string | undefined;
    try {
      const reservation = await getReservation(reservationId);
      listingId = reservation.listingId;
    } catch (e) {
      logger.error("Failed to fetch reservation from Guesty", { error: String(e) });
    }
    if (!listingId) {
      logger.error("Could not resolve Guesty listingId", { reservationId });
      return { status: "error", reason: "no_listing_id" };
    }

    // Step 3: Map to our Supabase property
    const supabase = getSupabaseClient();
    const { data: property, error: propError } = await supabase
      .from("properties")
      .select("*")
      .eq("guesty_listing_id", listingId)
      .single();

    if (propError || !property) {
      logger.error("Property not found in Supabase", { listingId, error: propError?.message });
      return { status: "error", reason: "property_not_synced" };
    }

    // Step 4: Cooldown check
    const { data: activeCooldowns } = await supabase
      .from("cooldowns")
      .select("*")
      .eq("property_id", property.id)
      .eq("is_active", true)
      .gt("expires_at", new Date().toISOString())
      .limit(1);

    if (activeCooldowns && activeCooldowns.length > 0) {
      logger.info("Property is in cooldown — ignoring message", {
        propertyId: property.id,
        cooldownExpires: activeCooldowns[0].expires_at,
      });
      return { status: "skipped", reason: "cooldown_active" };
    }

    // Step 5: Load conversation history from Guesty
    let conversationHistory: { role: string; content: string }[] = [];
    if (conversationId) {
      try {
        const thread = await getConversationThread(conversationId);
        conversationHistory = thread.map((m) => ({
          role: m.type === "fromGuest" || m.type === "fromThirdParty" ? "guest" : "host",
          content: m.body || "",
        }));
      } catch (e) {
        logger.warn("Failed to fetch conversation thread — using latest message only", {
          error: String(e),
        });
      }
    }
    if (conversationHistory.length === 0) {
      conversationHistory = [{ role: "guest", content: messageBody }];
    }

    // Build agent context
    const agentCtx: AgentContext = {
      propertyId: property.id,
      propertyName: property.name,
      reservationUuid: reservationId,
      conversationId,
      channelModule,
      conversationHistory,
      latestMessage: messageBody,
      guestName,
      timezone: property.timezone || "Australia/Melbourne",
    };

    // ── Phase 2: Agent Loop ─────────────────────────────────────────

    const historyText = conversationHistory
      .map((m) => `${m.role === "guest" ? "Guest" : "Host"}: ${m.content}`)
      .join("\n");

    // Step 6: Start the agent loop
    const anthropic = new Anthropic();

    const agentMessages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Here is the conversation so far:\n\n${historyText}\n\nThe guest's latest message is:\n"${messageBody}"`,
      },
    ];

    const systemPrompt = `# You don't know anything or can't help with anything except for what's inside this prompt and the tool calls.

# Role
You are an AI that responds to guest questions and handles the inbox of Phillip Island Host short-term rentals business.

# Output
Your reply is sent DIRECTLY to the guest. Whatever you write, the guest reads.
Never include internal reasoning, chain of thought, analysis, or notes about
what you're doing. Only write what you'd want the guest to see.

# Tool discipline
Never call the same tool twice with identical input in one turn. Call each tool at most
once unless new information from a previous tool result requires a different input.

# Language
- Detect the language the guest is writing in and reply in that same language.
- Warm, conversational answers with human touches.
- Avoid using the long "—" and write in fluid human like sentences.

# Context
Guests are messaging you through either Airbnb, Booking.com, another channel platform, or email because they've booked a stay and have a question, a maintenance request, or a request for a special item.

Property: ${property.name}
Guest name: ${guestName}

# Step by Step
1. Read the full conversation to understand context and tone.
2. Focus on the guest's latest message.
3. Classify the request and call the appropriate tool:
   - use_knowledge_base — ALWAYS call this first for any question or issue,
     including when a guest reports something not working (e.g. fireplace,
     thermostat, appliance, TV). The KB often has operating instructions
     or troubleshooting steps that solve the problem without maintenance.
   - raise_maintenance_ticket — Guest is reporting something broken,
     leaking, not working, damaged, or requiring physical repair AND
     either the knowledge base had no relevant troubleshooting info,
     or the conversation shows the guest already tried the suggested
     troubleshooting steps and the problem persists.
   - process_extra_request — Guest is requesting an additional item
     or service (towels, toiletries, blankets, pillows, etc.)
   - handle_checkin_checkout — Guest is asking about early check-in
     or late checkout. Always use this tool for these requests. Do NOT
     use the knowledge base for check-in/checkout time change requests.
   - escalate_to_human — The request doesn't fit any category above,
     or it's a complaint, billing issue, or something you can't handle.

# Confirmation Before Action
Before calling raise_maintenance_ticket or process_extra_request, you MUST first
confirm with the guest. Repeat back what you understood and ask them to confirm.
For example:
- "So you'd like me to request 4 extra towels, is that right? Just confirm and I'll let our team know!"
- "Just to make sure I have this right, the hot water in the bathroom isn't working? Let me know and I'll get our maintenance team on it."

Only call the tool when the conversation history already shows you asked for
confirmation AND the guest confirmed (e.g. "yes", "correct", "that's right",
"please", thumbs up, etc.). If the guest's latest message IS that confirmation,
go ahead and call the tool now.

This does NOT apply to use_knowledge_base, escalate_to_human, or
handle_checkin_checkout. Those can be called immediately without confirmation.

# Check-in / Checkout Requests
When you call handle_checkin_checkout and get the result back, ALWAYS reply
to the guest with exactly this message (translated to the guest's language):
"Not a problem. I'm going to check with our cleaning team to see if it's
possible and let you know."
Do not add anything else. Do not mention SMS, internal systems, or tickets.

# Host Decisions (synthetic)
If the latest message starts with "[host-decision]", it is NOT from the guest -
it is an internal signal from the host telling you what to write back. Follow
the instruction embedded in the message and reply directly to the guest in the
guest's language. Do NOT call any tool. Do NOT mention "host", "system", or
"approval" - simply communicate the outcome warmly to the guest.

4. After receiving the tool result, decide what to do:
   - If the tool result indicates escalation — do NOT reply to the guest. Stay silent.
   - Otherwise — compose a warm, concise reply to the guest based on the tool result.
     Do not mention internal systems, tickets, tools, or databases.`;

    logger.info("Starting coordinator agent", { propertyName: property.name });

    // ── Agent Loop: coordinator can call multiple tools in sequence ──
    const MAX_ITERATIONS = 5;
    let lastToolUsed = "";
    let replyText = "";

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages: agentMessages,
      });

      // Check if the AI produced a text reply (loop ends)
      const textBlock = response.content.find((b) => b.type === "text");
      const toolUseBlocks = response.content.filter(
        (b) => b.type === "tool_use"
      ) as (Anthropic.ContentBlockParam & { type: "tool_use"; name: string; input: any; id: string })[];

      // If no tool calls, extract text reply and exit loop
      if (toolUseBlocks.length === 0) {
        replyText = textBlock && "text" in textBlock ? textBlock.text : "";
        break;
      }

      // Guardrail: drop duplicate tool calls with identical input within a turn
      const dedupedToolUses = dedupeToolUses(toolUseBlocks);

      // Process all tool calls in this response
      const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
      for (const toolUseBlock of dedupedToolUses) {
        const toolName = toolUseBlock.name;
        const toolInput = toolUseBlock.input as Record<string, string>;
        lastToolUsed = toolName;
        logger.info(`Agent loop iteration ${i + 1}: tool=${toolName}`, { input: toolInput });

        // Handle escalation (HARD STOP — Sub-Workflow D)
        if (toolName === "escalate_to_human") {
          await supabase.from("agent_activity_log").insert({
            property_id: agentCtx.propertyId,
            reservation_uuid: agentCtx.reservationUuid,
            action_type: "escalation",
          });
          await subWorkflowD(toolInput.reason, messageBody, agentCtx);
          return { status: "escalated", reason: toolInput.reason };
        }

        // Execute the appropriate sub-workflow
        let toolResult: string;

        switch (toolName) {
          case "use_knowledge_base": {
            const result = await subWorkflowA(toolInput.query, agentCtx);
            if (result === null) {
              // No KB entries at all → HARD STOP, escalate to human immediately
              await supabase.from("agent_activity_log").insert({
                property_id: agentCtx.propertyId,
                reservation_uuid: agentCtx.reservationUuid,
                action_type: "escalation",
              });
              await subWorkflowD("Knowledge base had no answer", messageBody, agentCtx);
              return { status: "escalated", reason: "kb_no_answer" };
            }
            if (result.answer === "") {
              if (result.requiresMaintenance) {
                // KB had no troubleshooting info but it's a maintenance issue →
                // return to coordinator so it can raise a maintenance ticket
                toolResult = "NO_ANSWER_FOUND — No troubleshooting info in the knowledge base for this issue. This appears to require maintenance.";
              } else {
                // Genuine KB gap (informational) → HARD STOP, escalate to human
                await supabase.from("agent_activity_log").insert({
                  property_id: agentCtx.propertyId,
                  reservation_uuid: agentCtx.reservationUuid,
                  action_type: "escalation",
                });
                await subWorkflowD("Knowledge base had no answer", messageBody, agentCtx);
                return { status: "escalated", reason: "kb_no_answer" };
              }
            } else {
              await supabase.from("agent_activity_log").insert({
                property_id: agentCtx.propertyId,
                reservation_uuid: agentCtx.reservationUuid,
                action_type: "kb_answer",
              });
              toolResult = result.answer;
            }
            break;
          }

          case "raise_maintenance_ticket": {
            toolResult = await subWorkflowB(
              toolInput.issue_description,
              toolInput.guest_context,
              agentCtx
            );
            await supabase.from("agent_activity_log").insert({
              property_id: agentCtx.propertyId,
              reservation_uuid: agentCtx.reservationUuid,
              action_type: "maintenance",
            });
            break;
          }

          case "process_extra_request": {
            toolResult = await subWorkflowC(toolInput.item_requested, agentCtx);
            await supabase.from("agent_activity_log").insert({
              property_id: agentCtx.propertyId,
              reservation_uuid: agentCtx.reservationUuid,
              action_type: "extra_request",
            });
            if (toolResult.startsWith("__PENDING_APPROVAL__")) {
              logger.info("Extra request pending host approval - workflow ends silently");
              return { status: "pending_approval", reason: "awaiting host decision" };
            }
            break;
          }

          case "handle_checkin_checkout": {
            toolResult = await subWorkflowE(
              toolInput.request_type,
              toolInput.requested_time,
              agentCtx
            );
            await supabase.from("agent_activity_log").insert({
              property_id: agentCtx.propertyId,
              reservation_uuid: agentCtx.reservationUuid,
              action_type: "checkin_checkout",
            });
            break;
          }

          default:
            logger.error("Unknown tool called", { tool: toolName });
            toolResult = "Unknown tool — cannot process.";
            break;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUseBlock.id,
          content: toolResult,
        });
      }

      // Feed all tool results back to coordinator for next iteration
      agentMessages.push({
        role: "assistant",
        content: response.content as Anthropic.ContentBlockParam[],
      });

      agentMessages.push({
        role: "user",
        content: toolResults,
      });
    }

    if (!replyText) {
      logger.error("Agent produced no reply text");
      return { status: "error", reason: "no_reply_generated" };
    }

    // Append AI disclaimer footer
    const footer = `\n\n—\nThis message was automatically sent by my AI agent. In case of emergency, please call ${process.env.PHILLIP_ISLAND_PHONE || "our support line"}.`;
    const finalReply = replyText + footer;

    // Send the reply via Guesty on the same channel the guest used
    try {
      await sendMessage(conversationId, finalReply, channelModule);
      logger.info("Reply sent to guest", { conversationId, replyLength: replyText.length });
    } catch (e) {
      logger.error("Failed to send reply via Guesty", { error: String(e) });
      return { status: "error", reason: "guesty_send_failed" };
    }

    return {
      status: "replied",
      tool: lastToolUsed,
      replyLength: replyText.length,
    };
  },
});
