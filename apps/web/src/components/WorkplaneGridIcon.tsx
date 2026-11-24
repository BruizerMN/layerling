import { useId } from "react";
import type { SVGProps } from "react";

type WorkplaneGridIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
  /** The workplane is hidden: a diagonal slash through the grid (the state never depends on colour alone). */
  slashed?: boolean;
};

/**
 * The workplane as a plain geometric grid: a plate seen at an angle with two grid lines each way, on Lucide's 24 grid and stroke conventions so it sits beside the other
 * footer icons. Hidden: the same plate with a diagonal slash, and a small gap cut out of the grid around the slash so it reads at 15 pixels.
 */
export function WorkplaneGridIcon({ size = 24, strokeWidth = 2, slashed = false, ...props }: WorkplaneGridIconProps) {
  const maskId = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-slashed={slashed ? "true" : undefined}
      {...props}
    >
      {slashed ? (
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="white" stroke="none" />
          <path d="M3 3 21 21" stroke="black" strokeWidth={5} />
        </mask>
      ) : null}
      <g mask={slashed ? `url(#${maskId})` : undefined}>
        <path d="M12 4 22 12 12 20 2 12Z" />
        <path d="M7 8 17 16M17 8 7 16" strokeWidth={1.5} />
      </g>
      {slashed ? <path d="M3 3 21 21" /> : null}
    </svg>
  );
}
