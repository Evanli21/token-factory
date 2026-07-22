import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Token Factory — AI API Platform',
  description: 'One API for models, knowledge bases, agents, and workflows.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
