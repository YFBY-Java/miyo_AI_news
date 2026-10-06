import type { Metadata } from 'next';
import '../src/ui/studio.css';
export const metadata: Metadata = { title: 'miyo · 米游资讯视频工作台', description: '整理资讯、编辑分镜、合成配音，制作四种游戏风格的视频。' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html>; }
