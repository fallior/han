import { memo } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { formatTime } from '../../utils/formatters';
import { useStore } from '../../store';

interface MessageBubbleProps {
  role: string;
  content: string;
  timestamp: string;
}

// CSS color name/var → rgba for label display
const colorToRgba: Record<string, string> = {
  green: 'rgba(56,207,135,0.6)',
  purple: 'var(--text-muted)',
  blue: 'rgba(255,255,255,0.6)',
  amber: 'rgba(245,158,11,0.6)',
  red: 'rgba(239,68,68,0.6)',
  orange: 'rgba(249,115,22,0.6)',
  teal: 'rgba(20,184,166,0.6)',
  indigo: 'rgba(99,102,241,0.6)',
  gray: 'var(--text-muted)',
};

export const MessageBubble = memo(({ role, content, timestamp }: MessageBubbleProps) => {
  const roleMap = useStore((s) => s.roleMap);
  const info = roleMap[role];
  const roleLabel = info?.label || role.charAt(0).toUpperCase() + role.slice(1);
  const labelColor = info ? (colorToRgba[info.color] || info.color) : 'var(--text-muted)';
  const bubbleClass = `message-bubble ${role}`;

  return (
    <div className={bubbleClass}>
      <div
        style={{
          fontSize: '0.75rem',
          color: labelColor,
          marginBottom: '0.25rem',
          fontWeight: 500,
        }}
      >
        {roleLabel} · {formatTime(timestamp)}
      </div>
      <MarkdownRenderer content={content} />
    </div>
  );
});

MessageBubble.displayName = 'MessageBubble';
