import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const spaceGrotesk = localFont({
  src: [
    { path: '../public/fonts/SpaceGrotesk-Light.otf',   weight: '300', style: 'normal' },
    { path: '../public/fonts/SpaceGrotesk-Regular.otf', weight: '400', style: 'normal' },
    { path: '../public/fonts/SpaceGrotesk-Medium.otf',  weight: '500', style: 'normal' },
    { path: '../public/fonts/SpaceGrotesk-Bold.otf',    weight: '700', style: 'normal' },
  ],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Branch Map — Git Visualizer',
  description: 'See what your team is building, without reading a line of code.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
