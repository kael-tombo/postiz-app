import React from 'react';

/**
 * SocialFlow wordmark: a "flow" glyph (two stacked waves in the brand teal
 * with a violet drop) + the wordmark as live text. Theme-aware via currentColor
 * and the --new-btn-primary / --new-ai-btn variables.
 */
export const LogoTextComponent = () => {
  return (
    <div className="flex items-center gap-[10px]">
      <svg
        width="34"
        height="34"
        viewBox="0 0 34 34"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect width="34" height="34" rx="8" fill="var(--new-btn-primary)" />
        <path
          d="M6 13.5c3.2 0 3.2 3 6.4 3s3.2-3 6.4-3 3.2 3 6.4 3 3.2-3 3-3"
          stroke="white"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M6 20.5c3.2 0 3.2 3 6.4 3s3.2-3 6.4-3 3.2 3 6.4 3 3.2-3 3-3"
          stroke="#CCFBF1"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        <circle cx="26.5" cy="9" r="3" fill="var(--new-ai-btn)" />
      </svg>
      <span
        className="text-[26px] font-semibold tracking-tight"
        style={{ color: 'var(--new-btn-text)' }}
      >
        Social<span style={{ color: 'var(--new-btn-primary)' }}>Flow</span>
      </span>
    </div>
  );
};
