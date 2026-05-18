import type { NextConfig } from "next";

const isGithubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isGithubPages ? "/stamper" : "",
  assetPrefix: isGithubPages ? "/stamper/" : "",
};

export default nextConfig;
