// Word export (round 21): a Word-compatible .doc, made from HTML, for a roleplay lesson or a writing session.
// Adapted from LingoRole and LingoPen by MohammadReza Qaderi (MR-Qaderi), used with the author's written permission (2026-10-11).
// The layout idea (a titled report, tables, an optional transcript) follows those apps. The code is our own.
// Classic-script copy of web-app/src/services/wordExport.js: the same code, one global (SubifyWordExport).
// Keep the copies in step: chrome-mv3 and firefox-mv2 hold the same file.
(function (root) {
  "use strict";
  const WORD_FONTS = 'Vazir, Tahoma, Arial'

  const BLOCK_DIRS = ['ltr', 'rtl', 'auto']
  const LANG_CODE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/

  // Escapes the characters that matter in HTML text and attribute values.
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  // Escaped text with its line breaks kept as <br>.
  function lines(value) {
    return escapeHtml(value).replace(/\r?\n/g, '<br>')
  }

  function dirAttr(block) {
    return BLOCK_DIRS.includes(block?.dir) ? ` dir="${block.dir}"` : ''
  }

  function cellsHtml(row, tag) {
    return row.map(cell => `<${tag}>${lines(cell)}</${tag}>`).join('')
  }

  function tableHtml(block) {
    const head = Array.isArray(block.head) ? block.head : []
    const rows = (Array.isArray(block.rows) ? block.rows : [])
      .filter(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim()))
    if (!rows.length) return ''
    const thead = head.length ? `<thead><tr>${cellsHtml(head, 'th')}</tr></thead>` : ''
    const tbody = `<tbody>\n${rows.map(row => `<tr>${cellsHtml(row, 'td')}</tr>`).join('\n')}\n</tbody>`
    return `<table border="1" cellspacing="0" cellpadding="6"${dirAttr(block)}>\n${thead}\n${tbody}\n</table>`
  }

  function blockHtml(block) {
    const at = dirAttr(block)
    switch (block?.type) {
      case 'heading': {
        const text = String(block.text ?? '').trim()
        if (!text) return ''
        const tag = block.level === 3 ? 'h3' : 'h2'
        return `<${tag}${at}>${lines(text)}</${tag}>`
      }
      case 'para': {
        const text = String(block.text ?? '').trim()
        return text ? `<p${at}>${lines(text)}</p>` : ''
      }
      case 'list': {
        const items = (Array.isArray(block.items) ? block.items : [])
          .map(item => String(item ?? '').trim())
          .filter(Boolean)
        if (!items.length) return ''
        return `<ul${at}>\n${items.map(item => `<li>${lines(item)}</li>`).join('\n')}\n</ul>`
      }
      case 'table':
        return tableHtml(block)
      default:
        return ''
    }
  }

  function styleText(dir, align) {
    return [
      '@page { margin: 1.8cm; }',
      `body { font-family: ${WORD_FONTS}; font-size: 11pt; line-height: 1.8; color: #172033; direction: ${dir}; text-align: ${align}; }`,
      'h1 { font-size: 22pt; color: #24418c; margin: 0 0 8px; }',
      'h2 { font-size: 15pt; color: #24418c; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #dbe2ec; }',
      'h3 { font-size: 12pt; margin: 12px 0 4px; }',
      'p, li { margin: 6px 0; }',
      'table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; }',
      `th, td { border: 1px solid #9aa5b8; padding: 6px; vertical-align: top; text-align: ${align}; }`,
      'th { background: #eef2f8; font-weight: bold; }'
    ].join('\n')
  }

  // The whole document as one string. It starts with a UTF-8 byte order mark, so Word reads the Persian text correctly.
  // blocks: { type:'heading', text, level? } | { type:'para', text } | { type:'list', items:[] } |
  // { type:'table', head:[], rows:[[]] }. Any block can carry dir: 'ltr', 'rtl' or 'auto'.
  function buildWordDocument({ title = '', lang = 'en', rtl = false, blocks = [] } = {}) {
    const code = LANG_CODE.test(String(lang)) ? String(lang) : 'en'
    const dir = rtl ? 'rtl' : 'ltr'
    const align = rtl ? 'right' : 'left'
    const heading = String(title ?? '').trim()
    const body = (Array.isArray(blocks) ? blocks : []).map(blockHtml).filter(Boolean)
    return '﻿' + [
      '<!DOCTYPE html>',
      `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="${code}" dir="${dir}">`,
      '<head>',
      '<meta charset="utf-8">',
      `<title>${escapeHtml(heading)}</title>`,
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->',
      '<style>',
      styleText(dir, align),
      '</style>',
      '</head>',
      `<body lang="${code}" dir="${dir}">`,
      heading ? `<h1>${lines(heading)}</h1>` : '',
      ...body,
      '</body>',
      '</html>'
    ].filter(part => part !== '').join('\n')
  }

  // Saves the document as a file Word opens. Returns false when the browser does not allow it.
  function downloadWordDocument(filename, html) {
    try {
      const blob = new Blob([html], { type: 'application/msword' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      return true
    } catch {
      return false
    }
  }

  // subify-<kind>-YYYY-MM-DD.doc, with the date of the user's own calendar day.
  function wordFileName(kind, date = new Date()) {
    const name = String(kind ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'file'
    const pad = n => String(n).padStart(2, '0')
    return `subify-${name}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.doc`
  }

  const api = { WORD_FONTS, escapeHtml, buildWordDocument, downloadWordDocument, wordFileName };
  root.SubifyWordExport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
