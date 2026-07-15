const captionLineCharacters = 42;
const captionCueCharacters = 72;

export function buildWebVtt(segments) {
  let cursorMilliseconds = 0;
  const lines = [
    "WEBVTT",
    "",
    "NOTE Fictional Hartwell-Mercer demonstration. No real family data appears.",
    ""
  ];
  for (const segment of segments) {
    const durationMilliseconds = requireDuration(segment.durationSeconds) * 1_000;
    const phrases = splitCaptionPhrases(segment.text);
    const weights = phrases.map((phrase) => phrase.length);
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    let consumedWeight = 0;
    let cueStart = cursorMilliseconds;
    for (const [index, phrase] of phrases.entries()) {
      consumedWeight += weights[index];
      const cueEnd = index === phrases.length - 1
        ? cursorMilliseconds + durationMilliseconds
        : cursorMilliseconds + Math.round(durationMilliseconds * consumedWeight / totalWeight);
      if (cueEnd - cueStart < 1_250) {
        throw new Error("Launch caption cues must remain readable for at least 1.25 seconds.");
      }
      lines.push(
        `${formatVttMilliseconds(cueStart)} --> ${formatVttMilliseconds(cueEnd)}`,
        wrapCaptionPhrase(phrase),
        ""
      );
      cueStart = cueEnd;
    }
    cursorMilliseconds += durationMilliseconds;
  }
  if (cursorMilliseconds !== 90_000) throw new Error("Launch captions must end at exactly 90 seconds.");
  return `${lines.join("\n")}\n`;
}

export function buildTranscript(segments, sourceCommit) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("Launch transcript requires one source commit.");
  let cursor = 0;
  const lines = [
    "# Kin Resolve: evidence first, deliberately small",
    "",
    "**Duration:** 90 seconds  ",
    `**Source commit:** \`${sourceCommit}\`  `,
    "**Data disclosure:** Every name, date, place, record, filename, and workflow shown is fictional.  ",
    "**Audio disclosure:** The wordless ambient bed is generated entirely from mathematical tones; all tour language appears in captions and this transcript.",
    ""
  ];
  for (const segment of segments) {
    const duration = requireDuration(segment.durationSeconds);
    lines.push(
      `## ${formatTranscriptTime(cursor)}–${formatTranscriptTime(cursor + duration)}`,
      "",
      segment.text,
      ""
    );
    cursor += duration;
  }
  if (cursor !== 90) throw new Error("Launch transcript must end at exactly 90 seconds.");
  return `${lines.join("\n")}\n`;
}

function splitCaptionPhrases(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Launch caption text is required.");
  const words = text.trim().split(/\s+/);
  if (words.some((word) => word.length > captionLineCharacters)) {
    throw new Error("Launch caption contains an unbreakable long word.");
  }
  const minimumGroups = Math.ceil(text.trim().length / captionCueCharacters);
  for (let groupCount = minimumGroups; groupCount <= words.length; groupCount += 1) {
    const phrases = balancedPhrases(words, groupCount);
    if (
      phrases.length === groupCount
      && phrases.every((phrase) => {
        if (phrase.length > captionCueCharacters) return false;
        try {
          wrapCaptionPhrase(phrase);
          return true;
        } catch {
          return false;
        }
      })
    ) {
      return phrases;
    }
  }
  throw new Error("Launch caption text cannot fit the exact cue readability bounds.");
}

function balancedPhrases(words, groupCount) {
  const phrases = [];
  let cursor = 0;
  for (let group = 0; group < groupCount; group += 1) {
    const remainingGroups = groupCount - group;
    const remainingLength = words.slice(cursor).join(" ").length;
    const targetLength = Math.ceil(remainingLength / remainingGroups);
    let phrase = words[cursor];
    cursor += 1;
    while (cursor < words.length - (remainingGroups - 1)) {
      const candidate = `${phrase} ${words[cursor]}`;
      if (candidate.length > captionCueCharacters) break;
      if (
        candidate.length > targetLength
        && Math.abs(phrase.length - targetLength) <= Math.abs(candidate.length - targetLength)
      ) {
        break;
      }
      phrase = candidate;
      cursor += 1;
    }
    phrases.push(phrase);
  }
  return cursor === words.length ? phrases : [];
}

function wrapCaptionPhrase(phrase) {
  const lines = [];
  let line = "";
  for (const word of phrase.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= captionLineCharacters) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 2 || lines.some((value) => value.length > captionLineCharacters)) {
    throw new Error("Launch caption cue exceeds the exact two-line readability bound.");
  }
  return lines.join("\n");
}

function requireDuration(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Launch segment duration is invalid.");
  return value;
}

function formatVttMilliseconds(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
  const seconds = Math.floor(milliseconds % 60_000 / 1_000);
  const remainder = milliseconds % 1_000;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":") + `.${String(remainder).padStart(3, "0")}`;
}

function formatTranscriptTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
