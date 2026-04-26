import { defineConfig } from "astro/config";

// SHOTBREAK is a static + Netlify Functions app served from /shotbreak/.
// This Astro project exists only to satisfy `npm run build` and emit a tiny
// landing page at /. All Cloudflare Docs (Starlight, content collections,
// remark/rehype plugins, sitemap, link checker, skills loader, etc.) have
// been stripped — see `shotbreak/` for the real app.
export default defineConfig({
	site: "https://shotbreak.io",
	server: {
		port: 1111,
	},
});
