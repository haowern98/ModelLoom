import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { TextDecoder } from 'node:util';

const MAX_EVENT_BYTES = 1024 * 1024;
const TIMING_FIELDS = [
  'prompt_n',
  'prompt_ms',
  'prompt_per_second',
  'predicted_n',
  'predicted_ms',
  'predicted_per_second',
  'cache_n',
];
const USAGE_FIELDS = ['prompt_tokens', 'completion_tokens', 'total_tokens'];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function countCharacters(value) {
  let count = 0;
  for (let index = 0; index < value.length; index++, count++) {
    if (value.codePointAt(index) > 0xffff) index++;
  }
  return count;
}

function copyNumericFields(target, source, fields) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return;
  for (const field of fields) {
    const value = source[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      target[field] = value;
    }
  }
}

/**
 * Measures a streaming chat response and returns hashes, counts, and allowlisted metrics.
 * Request text, generated text, headers, and the supplied URL are never included in the report.
 */
export async function measureChatRequest(
  url,
  body,
  { headers = {}, signal, fetch: fetchImpl = globalThis.fetch, now = () => performance.now() } = {},
) {
  let serializedBody;
  let requestSha256;
  let requestHeaders;
  try {
    serializedBody = JSON.stringify(body);
    if (typeof serializedBody !== 'string') throw new Error();
    requestSha256 = sha256(serializedBody);
    requestHeaders = new globalThis.Headers({
      accept: 'text/event-stream',
      'content-type': 'application/json',
    });
    new globalThis.Headers(headers).forEach((value, name) => requestHeaders.set(name, value));
  } catch {
    throw new Error('Chat request failed.');
  }

  const startedAt = now();
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: requestHeaders,
      body: serializedBody,
      signal,
    });
  } catch {
    throw new Error('Chat request failed.');
  }

  const headersMs = now() - startedAt;
  if (!response?.ok || !response.body) {
    try {
      await response?.body?.cancel();
    } catch {
      // Preserve a generic error if the response body cannot be canceled.
    }
    throw new Error('Chat request failed.');
  }

  const contentHash = createHash('sha256');
  const reasoningHash = createHash('sha256');
  const timings = {};
  const usage = {};
  let contentCharacters = 0;
  let reasoningCharacters = 0;
  let firstTokenMs = null;
  let hasFinalResponse = false;
  let doneMarker = false;
  let wallMs = null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let lineBuffer = '';
  let eventData = [];
  let eventBytes = 0;

  const consumePayload = (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error();
    }
    if (Object.hasOwn(payload, 'error')) throw new Error();

    copyNumericFields(timings, payload, TIMING_FIELDS);
    copyNumericFields(timings, payload.timings, TIMING_FIELDS);
    copyNumericFields(usage, payload.usage, USAGE_FIELDS);

    if (!Array.isArray(payload.choices) || payload.choices.length > 1) throw new Error();
    if (hasFinalResponse && payload.choices.length) throw new Error();
    for (const choice of payload.choices) {
      if (!choice || typeof choice !== 'object') throw new Error();
      if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
        hasFinalResponse = true;
      } else if (choice.finish_reason !== null) throw new Error();

      const delta = choice.delta;
      if (!delta || typeof delta !== 'object') continue;
      const content = typeof delta.content === 'string' ? delta.content : '';
      const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
      if (firstTokenMs === null && (content.length > 0 || reasoning.length > 0)) {
        firstTokenMs = now() - startedAt;
      }
      if (content.length > 0) {
        contentHash.update(content);
        contentCharacters += countCharacters(content);
      }
      if (reasoning.length > 0) {
        reasoningHash.update(reasoning);
        reasoningCharacters += countCharacters(reasoning);
      }
    }
  };

  const consumeEvent = () => {
    if (eventData.length === 0) {
      eventBytes = 0;
      return;
    }
    const data = eventData.join('\n');
    eventData = [];
    eventBytes = 0;
    if (data.trim() === '[DONE]') {
      if (!hasFinalResponse) throw new Error();
      doneMarker = true;
      wallMs = now() - startedAt;
      return;
    }

    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new Error();
    }
    consumePayload(payload);
  };

  const consumeLine = (rawLine, lineByteLength) => {
    if (eventBytes + lineByteLength + 1 > MAX_EVENT_BYTES) throw new Error();
    eventBytes += lineByteLength + 1;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      if (doneMarker) {
        eventBytes = 0;
        eventData = [];
      } else {
        consumeEvent();
      }
      return;
    }
    if (doneMarker) {
      if (line.startsWith(':')) return;
      throw new Error();
    }
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    if (field !== 'data') return;
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    eventData.push(value);
  };

  const consumeText = (text) => {
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset);
      if (newline < 0) {
        const remainder = text.slice(offset);
        const nextLine = lineBuffer + remainder;
        if (eventBytes + Buffer.byteLength(nextLine, 'utf8') > MAX_EVENT_BYTES) throw new Error();
        lineBuffer = nextLine;
        return;
      }

      const rawLine = lineBuffer + text.slice(offset, newline);
      const lineByteLength = Buffer.byteLength(rawLine, 'utf8');
      lineBuffer = '';
      consumeLine(rawLine, lineByteLength);
      offset = newline + 1;
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        if (tail.length > 0) consumeText(tail);
        if (lineBuffer.length > 0) {
          const lineByteLength = Buffer.byteLength(lineBuffer, 'utf8');
          if (eventBytes + lineByteLength > MAX_EVENT_BYTES) throw new Error();
          consumeLine(lineBuffer, lineByteLength);
          lineBuffer = '';
        }
        break;
      }
      consumeText(decoder.decode(value, { stream: true }));
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The response is already unusable; preserve the generic diagnostic error.
    }
    try {
      reader.releaseLock();
    } catch {
      // A failed stream may already have released its reader.
    }
    throw new Error('Chat request failed.');
  }

  try {
    reader.releaseLock();
  } catch {
    // A closed response may already have released its reader.
  }

  if (!doneMarker || !hasFinalResponse) throw new Error('Chat request failed.');
  return {
    wallMs,
    headersMs,
    firstTokenMs,
    contentSha256: contentHash.digest('hex'),
    reasoningSha256: reasoningHash.digest('hex'),
    contentCharacters,
    reasoningCharacters,
    timings,
    usage,
    requestSha256,
  };
}
