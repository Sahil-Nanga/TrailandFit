/**
 * Where the 3D assets are served from. Each app copies packages/body3d/assets into
 * `public/body3d/` (scripts/copy-assets.mjs), so the URLs are the same in every app.
 */
export const ASSET_BASE = "/body3d";

export const assetUrl = (path: string) => `${ASSET_BASE}/${path}`;
