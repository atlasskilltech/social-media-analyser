import { InstagramIcon, YouTubeIcon, FacebookIcon, LinkedInIcon } from './icons';

/**
 * Per-platform presentation config.
 *
 * The only place the UI knows a platform exists. PlatformCard reads from here,
 * so all four cards share one component and one layout — `metrics` is the sole
 * difference between them.
 *
 * `metrics` maps unified-record keys onto card labels; `title` picks which
 * record field heads the card.
 */
export const PLATFORM_META = {
  instagram: {
    icon: InstagramIcon,
    text: 'text-brand-ig',
    border: 'border-brand-ig',
    accent: 'bg-linear-to-r from-[#833AB4] via-brand-ig to-[#F77737]',
    title: (d) => (d.username ? `@${d.username}` : d.displayName),
    subtitle: (d) => d.bio,
    metrics: [
      { label: 'Followers', key: 'followers' },
      { label: 'Following', key: 'following' },
      { label: 'Posts', key: 'posts' },
    ],
  },

  youtube: {
    icon: YouTubeIcon,
    text: 'text-brand-yt',
    border: 'border-brand-yt',
    accent: 'bg-linear-to-r from-[#FF0000] to-[#CC0000]',
    title: (d) => d.displayName || (d.username ? `@${d.username}` : null),
    subtitle: (d) => d.bio,
    metrics: [
      { label: 'Subscribers', key: 'subscribers' },
      { label: 'Videos', key: 'videos' },
    ],
  },

  facebook: {
    icon: FacebookIcon,
    text: 'text-brand-fb',
    border: 'border-brand-fb',
    accent: 'bg-linear-to-r from-[#1877F2] to-[#0C5DC4]',
    title: (d) => d.displayName,
    subtitle: (d) => d.bio,
    metrics: [
      { label: 'Followers', key: 'followers' },
      { label: 'Likes', key: 'likes' },
    ],
  },

  linkedin: {
    icon: LinkedInIcon,
    text: 'text-brand-li',
    border: 'border-brand-li',
    accent: 'bg-linear-to-r from-[#0A66C2] to-[#084C94]',
    title: (d) => d.displayName,
    subtitle: (d) => d.bio,
    metrics: [{ label: 'Followers', key: 'followers' }],
  },
};

/** Badge styling per record status. */
export const STATUS_STYLES = {
  success: {
    label: 'Live',
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  partial: {
    label: 'Partial',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  },
  blocked: {
    label: 'Blocked',
    className: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  },
  none: {
    label: 'No data',
    className: 'bg-line text-ink-soft',
  },
};
