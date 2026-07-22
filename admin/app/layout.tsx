import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Token Factory Admin', description: 'Operations console for Token Factory.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body>{children}</body></html>; }
