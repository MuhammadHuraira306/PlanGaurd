import type { MessageSourceType, ParsedMessage } from '../types/planguard.ts';

function detectChannel(text: string, sourceType: MessageSourceType): ParsedMessage['channel'] {
  if (sourceType === 'external_authoritative_clarification') {
    return 'clarification';
  }
  const lower = text.toLowerCase();
  if (/^(from|to|subject|date):/m.test(lower)) {
    return 'email';
  }
  if (/^\[?\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4},?\s+\d{1,2}:\d{2}|^\[\d{1,2}:\d{2}\s*(am|pm)?/im.test(text) || /whatsapp/i.test(lower)) {
    return 'whatsapp';
  }
  if (/^(notice|announcement|memo|bulletin|important):/im.test(lower)) {
    return 'notice';
  }
  return 'unknown';
}

function extractMetadataHints(block: string): {
  sender: string;
  timestamp: string;
  body: string;
  parseNotes: string[];
  uncertainBoundary: boolean;
} {
  const parseNotes: string[] = [];
  let sender = 'Unknown';
  let timestamp = 'Unspecified';
  let body = block.trim();
  let uncertainBoundary = false;

  // Pattern 1: Email headers (From:, Date:, Subject:)
  const fromMatch = body.match(/^From:\s*(.+)$/im);
  const dateMatch = body.match(/^(?:Date|Sent|Time):\s*(.+)$/im);
  if (fromMatch) {
    sender = fromMatch[1].trim();
    parseNotes.push('Extracted sender from email From: header');
  }
  if (dateMatch) {
    timestamp = dateMatch[1].trim();
    parseNotes.push('Extracted timestamp from email Date/Sent header');
  }

  // Pattern 2: WhatsApp style "[10:30 AM, 11/17/2026] Name: msg" or "11/17/26, 10:30 AM - Name: msg"
  if (sender === 'Unknown') {
    const waBracket = body.match(/^\[([^\]]+)\]\s*([^:\n]{2,50}):\s*([\s\S]+)$/);
    const waDash = body.match(/^(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4},?\s*\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*[-–]\s*([^:\n]{2,50}):\s*([\s\S]+)$/i);
    if (waBracket) {
      timestamp = waBracket[1].trim();
      sender = waBracket[2].trim();
      body = waBracket[3].trim();
      parseNotes.push('Parsed WhatsApp bracketed timestamp and sender');
    } else if (waDash) {
      timestamp = waDash[1].trim();
      sender = waDash[2].trim();
      body = waDash[3].trim();
      parseNotes.push('Parsed WhatsApp dash-separated timestamp and sender');
    }
  }

  // Pattern 3: Prefix "Sender (Time):" or "Name:" at start of message
  if (sender === 'Unknown') {
    const firstLine = body.split('\n')[0].trim();
    const senderWithTime = firstLine.match(/^([A-Za-z][A-Za-z0-9 ._-]{1,40})\s*\(([^)]+)\)\s*:\s*(.*)$/);
    const simpleColon = firstLine.match(/^([A-Za-z][A-Za-z0-9 ._-]{1,40}):\s*(.*)$/);
    if (senderWithTime) {
      sender = senderWithTime[1].trim();
      timestamp = senderWithTime[2].trim();
      const rest = [senderWithTime[3], ...body.split('\n').slice(1)].join('\n').trim();
      if (rest) body = rest;
      parseNotes.push('Extracted sender and parenthesized timestamp');
    } else if (
      simpleColon &&
      !/^(subject|note|important|update|warning|re|fwd|code freeze|venue|budget|food|schedule|judging)$/i.test(simpleColon[1].trim())
    ) {
      sender = simpleColon[1].trim();
      const rest = [simpleColon[2], ...body.split('\n').slice(1)].join('\n').trim();
      if (rest) body = rest;
      parseNotes.push('Extracted colon-prefixed sender label');
    }
  }

  // Fallback timestamp extraction inside text if still unspecified
  if (timestamp === 'Unspecified') {
    const inlineDate = body.match(/\b(\d{1,2}\s+(?:Nov|November|Oct|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep)[a-z]*\s+\d{4}(?:,?\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?|\d{1,2}:\d{2}\s*(?:AM|PM))\b/i);
    if (inlineDate) {
      timestamp = inlineDate[1].trim();
      parseNotes.push('Detected inline date/time reference');
    }
  }

  if (body.length > 1500) {
    uncertainBoundary = true;
    parseNotes.push('Unusually long block; boundary may contain merged messages');
  }

  return { sender, timestamp, body, parseNotes, uncertainBoundary };
}

function splitIntoRawBlocks(normalizedText: string): { blocks: string[]; uncertain: boolean; method: string } {
  const cleaned = normalizedText
    .split('\n')
    .filter((line) => !/^\s*#\s+/.test(line)) // ignore markdown comment title lines at top of sample files if any
    .join('\n')
    .trim();

  if (!cleaned) {
    return { blocks: [], uncertain: false, method: 'empty' };
  }

  // Strategy 1: Explicit separator lines (---, ===, ***)
  if (/^\s*[-=*]{3,}\s*$/m.test(cleaned)) {
    const parts = cleaned
      .split(/^\s*[-=*]{3,}\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      return { blocks: parts, uncertain: false, method: 'delimiter_lines' };
    }
  }

  // Strategy 2: Explicit Message headers ("Message 1:", "[Message 2]", "--- Message 3 ---")
  const msgHeaderPattern = /^(?:---+\s*)?(?:\[?\s*Message\s+#?\d+\s*\]?:?|MSG\s*#?\d+:?)/im;
  if (msgHeaderPattern.test(cleaned)) {
    const parts = cleaned
      .split(/(?=^(?:---+\s*)?(?:\[?\s*Message\s+#?\d+\s*\]?:?|MSG\s*#?\d+:?))/im)
      .map((s) => s.replace(/^(?:---+\s*)?(?:\[?\s*Message\s+#?\d+\s*\]?:?|MSG\s*#?\d+:?)\s*/i, '').trim())
      .filter(Boolean);
    if (parts.length >= 1) {
      return { blocks: parts, uncertain: false, method: 'message_headers' };
    }
  }

  // Strategy 3: Numbered blocks ("1. ...", "[1] ...", "1) ...") at start of lines
  const numberedMatches = cleaned.match(/^(?:\[\d+\]|\d+[.)])\s+/gm);
  if (numberedMatches && numberedMatches.length >= 2) {
    const parts = cleaned
      .split(/(?=^(?:\[\d+\]|\d+[.)])\s+)/m)
      .map((s) => s.replace(/^(?:\[\d+\]|\d+[.)])\s+/, '').trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return { blocks: parts, uncertain: false, method: 'numbered_list' };
    }
  }

  // Strategy 4: Email "From:" boundaries
  const fromMatches = cleaned.match(/^From:\s+/gm);
  if (fromMatches && fromMatches.length >= 2) {
    const parts = cleaned
      .split(/(?=^From:\s+)/m)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return { blocks: parts, uncertain: false, method: 'email_from_headers' };
    }
  }

  // Strategy 5: WhatsApp line timestamps
  const waLineMatches = cleaned.match(/^(?:\[\d{1,2}[:/]|(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4},?\s+\d{1,2}:\d{2}))/gm);
  if (waLineMatches && waLineMatches.length >= 2) {
    const parts = cleaned
      .split(/(?=^(?:\[\d{1,2}[:/]|(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4},?\s+\d{1,2}:\d{2})))/m)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return { blocks: parts, uncertain: false, method: 'whatsapp_timestamps' };
    }
  }

  // Strategy 6: Blank-line separated blocks
  const blankSplit = cleaned
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (blankSplit.length >= 2) {
    return { blocks: blankSplit, uncertain: false, method: 'blank_lines' };
  }

  // Strategy 7: Multiple non-empty lines without blank lines -> flag uncertain if multi-line
  const lines = cleaned.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 3 && lines.every((l) => l.includes(':'))) {
    return { blocks: lines, uncertain: true, method: 'line_by_line_fallback' };
  }

  return { blocks: [cleaned], uncertain: lines.length > 6, method: 'single_block' };
}

export function parseMessagePack(params: {
  normalizedText: string;
  sourceFile: string;
  startingIndex?: number;
  sourceType?: MessageSourceType;
  senderOverride?: string;
}): ParsedMessage[] {
  const startIdx = params.startingIndex ?? 1;
  const sourceType = params.sourceType ?? 'message_pack';

  const { blocks, uncertain, method } =
    sourceType === 'message_pack'
      ? splitIntoRawBlocks(params.normalizedText)
      : { blocks: [params.normalizedText.trim()], uncertain: false, method: 'single_message' };

  const now = new Date().toISOString();

  return blocks.map((rawBlock, i) => {
    const index = startIdx + i;
    const hints = extractMetadataHints(rawBlock);
    const channel = detectChannel(rawBlock, sourceType);

    if (uncertain) {
      hints.parseNotes.push(`Parsed via fallback strategy (${method}); review boundary if needed`);
    } else {
      hints.parseNotes.push(`Parsed via ${method}`);
    }

    const sender = params.senderOverride?.trim() || hints.sender;
    const id = `MSG-${String(index).padStart(3, '0')}`;

    return {
      id,
      index,
      rawText: rawBlock,
      body: hints.body,
      sender,
      senderRole: sourceType === 'external_authoritative_clarification' ? 'Authoritative Organizer' : 'Pending Classification',
      authorityLevel: sourceType === 'external_authoritative_clarification' ? 'high' : 'unverified',
      timestamp: hints.timestamp,
      channel,
      language: 'unknown',
      sourceType,
      sourceFile: params.sourceFile,
      uncertainBoundary: uncertain || hints.uncertainBoundary,
      parseNotes: hints.parseNotes,
      processingStatus: 'pending',
      decisionReason: 'Awaiting fact extraction and conflict resolution',
      receivedAt: now,
    };
  });
}
