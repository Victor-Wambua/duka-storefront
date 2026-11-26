export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="112" fill="#fbf5e9" />
      <circle cx="356" cy="146" r="56" fill="#f2b01e" />
      <path d="M118 206h276l-26 214a24 24 0 0 1-24 21H168a24 24 0 0 1-24-21z" fill="#0f4c3a" />
      <path d="M188 206v-28a68 68 0 0 1 136 0v28" fill="none" stroke="#0f4c3a" strokeWidth="26" strokeLinecap="round" />
      <path d="M152 318l26 26 26-26 26 26 26-26 26 26 26-26 26 26 26-26" fill="none" stroke="#f2b01e" strokeWidth="20" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M152 378l26 26 26-26 26 26 26-26 26 26 26-26 26 26 26-26" fill="none" stroke="#fbf5e9" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}
