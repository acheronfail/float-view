import type { IconName } from '$lib/ui/icon';
export const settingsCategories = [
  {
    slug: 'announcements',
    title: 'Ride announcements',
    description: 'Speed, load, footpad and battery alerts',
    icon: 'bell',
  },
  {
    slug: 'recording',
    title: 'Ride recording',
    description: 'Location, ride breaks and recording detail',
    icon: 'route',
  },
  {
    slug: 'connection',
    title: 'Connection & permissions',
    description: 'Reconnecting, Bluetooth and location access',
    icon: 'bluetooth',
  },
  { slug: 'data', title: 'Data & backups', description: 'Export, import and CSV options', icon: 'archive' },
  {
    slug: 'help',
    title: 'Help & diagnostics',
    description: 'Troubleshooting and diagnostic reports',
    icon: 'circle-help',
  },
  { slug: 'about', title: 'About', description: 'Source code and licences', icon: 'info' },
] as const satisfies readonly { slug: string; title: string; description: string; icon: IconName }[];
export function settingsCategory(slug: string | undefined) {
  return settingsCategories.find((category) => category.slug === slug);
}
