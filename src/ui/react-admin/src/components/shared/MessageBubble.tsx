import { memo } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { formatTime } from '../../utils/formatters';

interface MessageBubbleProps {
  role: string;
  content: string;
  timestamp: string;
}

const getRoleLabel = (role: string): string => {
  switch (role) {
    case 'human':
      return 'Darron';
    case 'supervisor':
      return 'Jim';
    case 'leo':
      return 'Leo';
    default:
      return role;
  }
};

const getLabelColor = (role: string): string => {
  switch (role) {
    case 'human':
      return 'rgba(255,255,255,0.6)';
    case 'leo':
      return 'rgba(56,207,135,0.6)';
    case 'supervisor':
      return 'var(--text-muted)';
    default:
      return 'var(--text-muted)';
  }
};

export const MessageBubble = memo(({ role, content, timestamp }: MessageBubbleProps) => {
  const roleLabel = getRoleLabel(role);
  const labelColor = getLabelColor(role);
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
