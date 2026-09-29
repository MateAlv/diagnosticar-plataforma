import type { ReactNode } from "react";

/** Small line icons, decorative: whatever they show is also said in text. */

type IconProps = { className?: string };

function Icon({ className = "h-4 w-4", children }: IconProps & { children: ReactNode }) {
    return (
        <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            {children}
        </svg>
    );
}

export const CheckIcon = (props: IconProps) => (
    <Icon {...props}>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
);

export const InfoIcon = (props: IconProps) => (
    <Icon {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5.5M12 7.6v.1" />
    </Icon>
);

export const AlertIcon = (props: IconProps) => (
    <Icon {...props}>
        <path d="M10.3 4.2 2.9 17.4A2 2 0 0 0 4.6 20.4h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
        <path d="M12 9.5v4.2M12 16.8v.1" />
    </Icon>
);

export const ShieldIcon = (props: IconProps) => (
    <Icon {...props}>
        <path d="M12 3.2 5 6v5.6c0 4.2 2.9 7.7 7 9.2 4.1-1.5 7-5 7-9.2V6l-7-2.8z" />
        <path d="m9 12 2.2 2.2L15.4 10" />
    </Icon>
);

export const QuestionIcon = (props: IconProps) => (
    <Icon {...props}>
        <path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3.5 21l1.4-4.7A8.5 8.5 0 1 1 21 12z" />
        <path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.8c0 1.5-2.2 2-2.2 3.2M12 16.4v.1" />
    </Icon>
);

export const RoundsIcon = (props: IconProps) => (
    <Icon {...props}>
        <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" />
        <path d="M20 4v4.5h-4.5" />
        <path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5" />
        <path d="M4 20v-4.5h4.5" />
    </Icon>
);

export const ClockIcon = (props: IconProps) => (
    <Icon {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 2" />
    </Icon>
);

export const CopyIcon = (props: IconProps) => (
    <Icon {...props}>
        <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2" />
        <path d="M15.5 8.5V6.2A2.2 2.2 0 0 0 13.3 4H6.2A2.2 2.2 0 0 0 4 6.2v7.1a2.2 2.2 0 0 0 2.2 2.2h2.3" />
    </Icon>
);

export const PrintIcon = (props: IconProps) => (
    <Icon {...props}>
        <path d="M7 9V4h10v5" />
        <rect x="3.5" y="9" width="17" height="8" rx="2" />
        <path d="M7 14h10v6H7z" />
    </Icon>
);

export const PlusIcon = (props: IconProps) => (
    <Icon {...props}>
        <path d="M12 5v14M5 12h14" />
    </Icon>
);

const CHEVRON_PATHS = { right: "m9.5 6 6 6-6 6", down: "m6 9.5 6 6 6-6", left: "m14.5 6-6 6 6 6", up: "m6 14.5 6-6 6 6" };

export const ChevronIcon = ({ direction, ...props }: IconProps & { direction: keyof typeof CHEVRON_PATHS }) => (
    <Icon {...props}>
        <path d={CHEVRON_PATHS[direction]} />
    </Icon>
);

export const RefreshIcon = (props: IconProps) => (
    <Icon {...props}>
        <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
        <path d="M4 3.5V8h4.5" />
        <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
        <path d="M20 20.5V16h-4.5" />
    </Icon>
);

export const SummaryIcon = (props: IconProps) => (
    <Icon {...props}>
        <rect x="5" y="3.5" width="14" height="17" rx="2.2" />
        <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
    </Icon>
);
