/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fully static site: `next build` emits a plain `out/` folder (no server
  // runtime). Every route is prerendered; the hero + journeys fetch their data
  // from /data/*.json at runtime. Deployable to any static host, free.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
