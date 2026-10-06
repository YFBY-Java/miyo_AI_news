import type { NextConfig } from 'next';
const config: NextConfig = { devIndicators: false, distDir: process.env.MOYO_NEXT_DIST_DIR || '.next', serverExternalPackages: ['playwright'] };
export default config;
