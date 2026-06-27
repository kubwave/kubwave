import { defineConfig } from '@hey-api/openapi-ts';
import { clientFetch, sdk, typescript } from '@hey-api/openapi-ts/plugins';

export default defineConfig({
	input: './openapi.json',
	output: './src/generated',
	plugins: [typescript(), sdk(), clientFetch()]
});
