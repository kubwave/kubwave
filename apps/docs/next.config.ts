import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	output: 'export',
	trailingSlash: true,
	images: { unoptimized: true },
	// docs.localhost: the Tilt dev workload's ingress host.
	allowedDevOrigins: ['127.0.0.1', 'docs.localhost'],
	devIndicators: false
};

// Plugins as strings: Turbopack only accepts serializable MDX options.
const withMDX = createMDX({
	options: {
		remarkPlugins: ['remark-gfm'],
		rehypePlugins: [
			'rehype-slug',
			['@shikijs/rehype', { themes: { light: 'github-light', dark: 'github-dark' }, langs: ['sh', 'bash', 'yaml', 'dockerfile', 'mdx'] }]
		]
	}
});

export default withMDX(nextConfig);
