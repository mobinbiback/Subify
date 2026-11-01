// Timestamped notes as Markdown (pastes into Notion and most note apps), as an Anki import file,
// and the data for one quote card. Plain script: the learn page loads it before learn.js.
(function (root) {
  "use strict";

  const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const pad = (n) => String(n).padStart(2, "0");

  // mm:ss from seconds (minutes can go past 59 for long videos)
  function clockOf(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  }

  // Notes with text, in the order given: { sec, text, title, link }.
  function noteRows(notes, linkFor) {
    return (Array.isArray(notes) ? notes : [])
      .filter((n) => n && typeof n === "object")
      .map((n) => ({
        sec: Number.isFinite(Number(n.t)) ? Math.max(0, Number(n.t)) : 0,
        text: clean(n.text),
        title: clean(n.title),
        link: typeof linkFor === "function" ? clean(linkFor(n)) : ""
      }))
      .filter((row) => row.text);
  }

  // "- [mm:ss](link) text" for each note, under a "# title" heading. Without a link the time is plain text.
  function sentencesMarkdown(notes, { title = "", linkFor = null } = {}) {
    const lines = [];
    const heading = clean(title);
    if (heading) lines.push(`# ${heading}`, "");
    for (const row of noteRows(notes, linkFor)) {
      const stamp = clockOf(row.sec);
      lines.push(row.link ? `- [${stamp}](${row.link}) ${row.text}` : `- [${stamp}] ${row.text}`);
    }
    return lines.join("\n") + "\n";
  }

  // Anki reads tab-separated text: front = the sentence, back = where it came from, tags = the video and the time.
  function sentencesAnki(notes, { title = "" } = {}) {
    const tidy = (value) => clean(value).replace(/\t/g, " ");
    const lines = ["#separator:tab", "#html:false", "#tags column:3"];
    const source = tidy(title).replace(/\s+/g, "_");
    for (const row of noteRows(notes, null)) {
      const stamp = clockOf(row.sec);
      const back = `${tidy(row.title) || "Subify"} · ${stamp}`;
      const tags = ["subify", source, `at_${stamp.replace(":", "_")}`].filter(Boolean).join(" ");
      lines.push([tidy(row.text), back, tags].join("\t"));
    }
    return lines.join("\n") + "\n";
  }

  // The data SubifyCard.makeCardPng takes: the sentence is the headline, the time and the video are the chips and the example line.
  function quoteCardData(note, { fromLabel = "From", linkFor = null } = {}) {
    const row = noteRows([note], linkFor)[0];
    if (!row) return null;
    return {
      card: {
        pos: "Quote",
        level: clockOf(row.sec),
        word: row.text,
        meaning: "",
        example: row.title,
        translation: ""
      },
      labels: { example: fromLabel },
      // The link to the same moment of the video, to share next to the card image.
      text: row.link || ""
    };
  }

  root.SubifySentences = { clockOf, sentencesMarkdown, sentencesAnki, quoteCardData };
})(typeof window !== "undefined" ? window : globalThis);
