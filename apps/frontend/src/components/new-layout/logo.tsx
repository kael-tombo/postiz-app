'use client';

export const Logo = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="60"
      height="60"
      viewBox="0 0 34 34"
      fill="none"
      className="mt-[8px] min-w-[34px] min-h-[34px]"
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
  );
};
