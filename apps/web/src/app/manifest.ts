import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'IzanDesk Customer Self-Care',
    short_name: 'IzanDesk',
    description: 'IzanDesk ISP self-care portal: subscription, invoices, payments, speedtest and Wi-Fi management.',
    start_url: '/portal',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#0891b2',
    icons: [],
  };
}
