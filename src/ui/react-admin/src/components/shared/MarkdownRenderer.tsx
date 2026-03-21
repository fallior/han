import React from 'react';

interface MarkdownRendererProps {
  content: string;
}

/**
 * Escapes HTML entities by leveraging browser DOM APIs.
 * Same approach as admin.ts escapeHtml function.
 */
function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/**
 * Renders markdown to HTML using regex-based transforms.
 * Ported from admin.ts renderMarkdown function (lines 111-148).
 */
function renderMarkdown(text: string): string {
  // Escape HTML first, then apply markdown patterns
  let html = escapeHtml(text);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre style="background:var(--bg-input);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px;margin:8px 0"><code>${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-input);padding:1px 5px;border-radius:3px;font-size:12px">$1</code>');

  // Headers (## and ###)
  html = html.replace(/^### (.+)$/gm, '<h4 style="margin:12px 0 4px;font-size:13px;color:var(--text-heading)">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 style="margin:14px 0 6px;font-size:14px;color:var(--text-heading)">$1</h3>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border-subtle);margin:12px 0">');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li style="margin-left:16px;list-style:disc;font-size:inherit">$1</li>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;list-style:decimal;font-size:inherit">$1</li>');

  // Paragraphs — double newlines become paragraph breaks
  html = html.replace(/\n\n/g, '</p><p style="margin:8px 0">');

  // Single newlines become <br> (except inside pre/code blocks handled above)
  html = html.replace(/\n/g, '<br>');

  return `<p style="margin:0">${html}</p>`;
}

/**
 * MarkdownRenderer component
 *
 * Takes markdown-formatted content and renders it as HTML using the same
 * regex-based approach as the vanilla admin (admin.ts lines 111-148).
 *
 * Memoised since content rarely changes after initial render.
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(({ content }) => {
  const html = renderMarkdown(content);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;
