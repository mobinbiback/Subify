// Quote card for the learn page: the same drawing as the web app's vocabulary card (cardImage.js), as a plain
// script. Generated from the web app's file; keep the two in step when the card design changes.
(function (root) {
'use strict';
// Shareable vocabulary card (r21).
// drawCardCanvas is the pure part: it takes the card data and returns a 1080 x 1350 canvas, laid out right to left
// in the Vazir font the app already ships. Wrapping and layout are plain functions with no DOM, so they can be
// checked on their own. Sharing and saving sit on top of that.

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1350
const CARD_SITE = 'https://app.sub-ify.site'

const FAMILY = 'SubifyCardVazir'
const FONT_URL = (globalThis.browser || globalThis.chrome).runtime.getURL('fonts/IRANYekanX-Medium.ttf')
const PAD = 90
const PANEL_PAD = 46
const TEXT_W = CARD_WIDTH - PAD * 2
const CHIP_H = 60
// The body sits between these y values. The footer rule is below BODY_BOTTOM.
const BODY_TOP = 110
const BODY_BOTTOM = 1140
const FOOTER_RULE = 1196

// Text sizes, large to small. At each size the line caps below are tried, most lines first.
const TIERS = [
  { word: 200, meaning: 76, example: 50, translation: 40 },
  { word: 168, meaning: 66, example: 44, translation: 36 },
  { word: 140, meaning: 58, example: 40, translation: 32 },
  { word: 116, meaning: 50, example: 36, translation: 30 },
  { word: 100, meaning: 44, example: 32, translation: 28 }
]
// Line caps. NO_CAP first: a size where nothing is cut is always preferred. Cutting (with an ellipsis) is the last resort.
const NO_CAP = { word: 8, meaning: 8, example: 8, translation: 8 }
const CAPS = [
  { word: 2, meaning: 3, example: 4, translation: 3 },
  { word: 2, meaning: 2, example: 3, translation: 2 },
  { word: 1, meaning: 2, example: 2, translation: 1 }
]

// Brand violet is the accent in both looks. Colours are plain strings, so the canvas can use them directly.
const PALETTE = {
  dark: {
    top: '#0b0e17',
    bottom: '#151b2b',
    glow: 'rgba(134, 108, 255, 0.30)',
    glowFade: 'rgba(134, 108, 255, 0)',
    ink: '#f5f7fb',
    body: '#d3dae6',
    muted: '#97a2b8',
    accent: '#a897ff',
    chip: 'rgba(134, 108, 255, 0.22)',
    chipInk: '#ddd6ff',
    panel: 'rgba(255, 255, 255, 0.06)',
    panelLine: 'rgba(255, 255, 255, 0.14)',
    rule: 'rgba(255, 255, 255, 0.14)'
  },
  light: {
    top: '#ffffff',
    bottom: '#eef0f8',
    glow: 'rgba(134, 108, 255, 0.20)',
    glowFade: 'rgba(134, 108, 255, 0)',
    ink: '#0f1420',
    body: '#222a37',
    muted: '#5b6578',
    accent: '#6b52e8',
    chip: 'rgba(107, 82, 232, 0.12)',
    chipInk: '#4b2fc4',
    panel: 'rgba(15, 20, 32, 0.04)',
    panelLine: 'rgba(15, 20, 32, 0.12)',
    rule: 'rgba(15, 20, 32, 0.12)'
  }
}

const EM_DASH = /\s*\u2014\s*/g
const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/
const LTR_CHAR = /[A-Za-zÀ-ɏ]/

function fontFor(weight, size) {
  return `${weight} ${size}px ${FAMILY}, Vazir, sans-serif`
}

// Errors from making the image carry a code: FONT (the Vazir file did not load) or CANVAS (drawing or PNG encoding failed).
function cardImageError(code, cause) {
  const err = new Error(`card image: ${code}`)
  err.code = code
  if (cause) err.cause = cause
  return err
}

// Base direction of a text, from its first letter. Each block uses its own, so an English sentence and a Persian line both sit right.
function textDir(text, fallback = 'rtl') {
  for (const ch of String(text || '')) {
    if (RTL_CHAR.test(ch)) return 'rtl'
    if (LTR_CHAR.test(ch)) return 'ltr'
  }
  return fallback
}

// The card's text as the image shows it. Em dashes become a plain hyphen, so the image never carries one.
function cardContent(card = {}, labels = {}) {
  const clean = value => String(value == null ? '' : value).replace(EM_DASH, ' - ').replace(/\s+/g, ' ').trim()
  const example = clean(card.example)
  // Without a dictionary example, the sentence the word was saved from stands in, with its own translation.
  const sentence = clean(card.sentence)
  return {
    word: clean(card.word),
    chips: [clean(card.pos), clean(card.level)].filter(Boolean),
    meaning: clean(card.meaning),
    example: example || sentence,
    translation: clean(example ? card.exampleTr : card.translation),
    label: clean(labels.example) || 'Example'
  }
}

// Lines no wider than maxWidth. measure(text) gives a width in pixels. A word wider than a line is cut between characters.
function wrapLines(text, maxWidth, measure) {
  const lines = []
  let line = ''
  for (const word of String(text || '').split(' ').filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (measure(next) <= maxWidth) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = ''
    let rest = word
    while (rest.length > 1 && measure(rest) > maxWidth) {
      let cut = 1
      while (cut < rest.length && measure(rest.slice(0, cut + 1)) <= maxWidth) cut++
      lines.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    line = rest
  }
  if (line) lines.push(line)
  return lines
}

// Keeps at most maxLines lines. When text is cut, the last kept line ends with an ellipsis.
function clampLines(lines, maxLines, maxWidth, measure) {
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length && measure(`${last}…`) > maxWidth) last = last.slice(0, -1).trimEnd()
  kept[maxLines - 1] = `${last}…`
  return kept
}

function fit(text, width, maxLines, measure) {
  return clampLines(wrapLines(text, width, measure), maxLines, width, measure)
}

function block(y, size, lh, lines, weight, color, dir) {
  return { y, size, lh, lines, weight, color, dir }
}

// Places every block at one size tier and one set of line caps. y values are relative to the top of the body.
function planAt(c, tier, caps, measureFor) {
  const plan = { height: 0, chips: c.chips, word: null, rule: 0, meaning: null, panel: null }
  let y = 0
  if (c.chips.length) y += CHIP_H + 52
  if (c.word) {
    const lh = Math.round(tier.word * 1.12)
    const lines = fit(c.word, TEXT_W, caps.word, measureFor(700, tier.word))
    plan.word = block(y, tier.word, lh, lines, 700, 'ink', textDir(c.word, 'ltr'))
    y += lines.length * lh + 34
    plan.rule = y
    y += 8 + 44
  }
  if (c.meaning) {
    const lh = Math.round(tier.meaning * 1.32)
    const lines = fit(c.meaning, TEXT_W, caps.meaning, measureFor(600, tier.meaning))
    plan.meaning = block(y, tier.meaning, lh, lines, 600, 'ink', textDir(c.meaning, 'rtl'))
    y += lines.length * lh
  }
  if (c.example) {
    y += 56
    const top = y
    const inner = TEXT_W - PANEL_PAD * 2
    const label = block(top + PANEL_PAD, 34, 40, [c.label], 700, 'accent', textDir(c.label, 'rtl'))
    let iy = top + PANEL_PAD + 40 + 14
    const exLh = Math.round(tier.example * 1.4)
    const exLines = fit(c.example, inner, caps.example, measureFor(500, tier.example))
    const example = block(iy, tier.example, exLh, exLines, 500, 'body', textDir(c.example, 'ltr'))
    iy += exLines.length * exLh
    let translation = null
    if (c.translation) {
      iy += 16
      const trLh = Math.round(tier.translation * 1.4)
      const trLines = fit(c.translation, inner, caps.translation, measureFor(400, tier.translation))
      translation = block(iy, tier.translation, trLh, trLines, 400, 'muted', textDir(c.translation, 'rtl'))
      iy += trLines.length * trLh
    }
    plan.panel = { y: top, height: iy + PANEL_PAD - top, label, example, translation }
    y = top + plan.panel.height
  }
  plan.height = y
  return plan
}

// The largest sizes whose layout fits the body, with no text cut if any size allows it. measureFor(weight, size)
// returns a width function. Only when no size fits the whole text is it cut, most lines first.
function planCard(content, measureFor) {
  const fits = plan => plan.height <= BODY_BOTTOM - BODY_TOP
  let plan = null
  for (const tier of TIERS) {
    plan = planAt(content, tier, NO_CAP, measureFor)
    if (fits(plan)) return plan
  }
  for (const tier of TIERS) {
    for (const caps of CAPS) {
      plan = planAt(content, tier, caps, measureFor)
      if (fits(plan)) return plan
    }
  }
  return plan
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function paintBackground(ctx, colors) {
  const base = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT)
  base.addColorStop(0, colors.top)
  base.addColorStop(1, colors.bottom)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  const glow = ctx.createRadialGradient(CARD_WIDTH, 0, 0, CARD_WIDTH, 0, 760)
  glow.addColorStop(0, colors.glow)
  glow.addColorStop(1, colors.glowFade)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
}

function drawBlock(ctx, b, top, right, colors) {
  ctx.font = fontFor(b.weight, b.size)
  ctx.fillStyle = colors[b.color]
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.direction = b.dir
  b.lines.forEach((line, i) => ctx.fillText(line, right, top + b.y + i * b.lh))
}

function drawChips(ctx, chips, top, colors) {
  ctx.font = fontFor(600, 34)
  let right = CARD_WIDTH - PAD
  for (const text of chips) {
    const w = ctx.measureText(text).width + 60
    const x = right - w
    roundRect(ctx, x, top, w, CHIP_H, CHIP_H / 2)
    ctx.fillStyle = colors.chip
    ctx.fill()
    ctx.fillStyle = colors.chipInk
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.direction = textDir(text, 'ltr')
    ctx.fillText(text, x + w / 2, top + CHIP_H / 2 + 1)
    right = x - 16
  }
}

function drawFooter(ctx, colors) {
  ctx.fillStyle = colors.rule
  ctx.fillRect(PAD, FOOTER_RULE, TEXT_W, 2)
  const y = FOOTER_RULE + 2 + (CARD_HEIGHT - FOOTER_RULE - 2) / 2
  ctx.textBaseline = 'middle'
  ctx.direction = 'ltr'
  ctx.font = fontFor(700, 40)
  ctx.fillStyle = colors.ink
  ctx.textAlign = 'right'
  ctx.fillText('Subify', CARD_WIDTH - PAD, y)
  ctx.font = fontFor(500, 32)
  ctx.fillStyle = colors.muted
  ctx.textAlign = 'left'
  ctx.fillText(CARD_SITE, PAD, y)
}

// Draws the card and returns the canvas (1080 x 1350). The Vazir font must be loaded first (see loadCardFont).
function drawCardCanvas(card, { look = 'dark', labels = {} } = {}) {
  const colors = PALETTE[look] || PALETTE.dark
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw cardImageError('CANVAS')

  const measureFor = (weight, size) => {
    ctx.font = fontFor(weight, size)
    return text => ctx.measureText(text).width
  }
  const plan = planCard(cardContent(card, labels), measureFor)
  const top = BODY_TOP + Math.max(0, Math.floor((BODY_BOTTOM - BODY_TOP - plan.height) / 2))
  const right = CARD_WIDTH - PAD

  paintBackground(ctx, colors)
  drawChips(ctx, plan.chips, top, colors)
  if (plan.word) {
    drawBlock(ctx, plan.word, top, right, colors)
    roundRect(ctx, right - 120, top + plan.rule, 120, 8, 4)
    ctx.fillStyle = colors.accent
    ctx.fill()
  }
  if (plan.meaning) drawBlock(ctx, plan.meaning, top, right, colors)
  if (plan.panel) {
    const p = plan.panel
    roundRect(ctx, PAD, top + p.y, TEXT_W, p.height, 40)
    ctx.fillStyle = colors.panel
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = colors.panelLine
    ctx.stroke()
    const inner = right - PANEL_PAD
    drawBlock(ctx, p.label, top, inner, colors)
    drawBlock(ctx, p.example, top, inner, colors)
    if (p.translation) drawBlock(ctx, p.translation, top, inner, colors)
  }
  drawFooter(ctx, colors)
  return canvas
}

let fontReady = null

// Loads the Vazir file once for the canvas. Rejects with an error whose code is FONT when it does not load.
function loadCardFont() {
  if (!fontReady) {
    fontReady = (async () => {
      if (typeof FontFace !== 'function' || !document.fonts) throw new Error('FontFace is not supported')
      const face = new FontFace(FAMILY, `url(${FONT_URL})`, { weight: '100 900' })
      await face.load()
      document.fonts.add(face)
      if (!document.fonts.check(`700 40px ${FAMILY}`)) throw new Error('font is not ready')
    })().catch(cause => {
      fontReady = null
      throw cardImageError('FONT', cause)
    })
  }
  return fontReady
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(cardImageError('CANVAS'))), 'image/png')
    } catch (cause) {
      reject(cardImageError('CANVAS', cause))
    }
  })
}

// The card as a PNG blob. Rejects with an error whose code is FONT or CANVAS.
async function makeCardPng(card, options = {}) {
  await loadCardFont()
  let canvas
  try {
    canvas = drawCardCanvas(card, options)
  } catch (cause) {
    throw cardImageError('CANVAS', cause)
  }
  return canvasToPng(canvas)
}

// File name for a card: subify-card-<word>.png. Letters and digits stay; anything else becomes a dash.
function cardFileName(word) {
  const slug = String(word || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `subify-card-${slug || 'word'}.png`
}


// Share card after a subtitle translation: the first translated line is the big line, its original sits under it,
// and up to two more lines from the same file go in the panel. Uses the same layout as the vocabulary card.
function translationCardData(pairs = [], { sourceLabel = '', targetLabel = '', moreLabel = '' } = {}) {
  const usable = pairs.filter(p => p && String(p.translated || '').trim())
  if (!usable.length) return null
  const [first, ...rest] = usable
  const more = rest.slice(0, 2)
  return {
    card: {
      pos: sourceLabel || 'Subtitle',
      level: targetLabel,
      word: first.translated,
      meaning: first.original,
      example: more.map(p => p.original).join(' · '),
      translation: more.map(p => p.translated).join(' · ')
    },
    labels: { example: moreLabel || 'More from this file' }
  }
}

// Share card after a vocabulary review: the headline is the count, the panel lists some of the words reviewed.
function reviewCardData(words = [], { headline = '', moreLabel = '' } = {}) {
  const usable = words.filter(w => w && String(w.word || '').trim())
  if (!usable.length) return null
  const shown = usable.slice(0, 3)
  return {
    card: {
      pos: 'Review',
      word: headline || String(usable.length),
      meaning: shown[0].meaning || shown[0].word,
      example: shown.map(w => w.word).join(' · '),
      translation: shown.map(w => w.meaning).filter(Boolean).join(' · ')
    },
    labels: { example: moreLabel || 'Words from this review' }
  }
}

root.SubifyCard = { drawCardCanvas, makeCardPng, cardFileName, loadCardFont, cardContent, planCard, wrapLines, clampLines };
})(typeof window !== 'undefined' ? window : globalThis);
