import type { FC, SVGProps } from 'react'

/** Gun-barrel scope reticle — USDT007 brand icon for wallet/agent context */
export const Reticle: FC<SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {/* Outer ring */}
    <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
    {/* Inner ring */}
    <circle cx="12" cy="12" r="4" strokeWidth={1.5} />
    {/* Top tick */}
    <line x1="12" y1="1" x2="12" y2="5" />
    {/* Bottom tick */}
    <line x1="12" y1="19" x2="12" y2="23" />
    {/* Left tick */}
    <line x1="1" y1="12" x2="5" y2="12" />
    {/* Right tick */}
    <line x1="19" y1="12" x2="23" y2="12" />
  </svg>
)
