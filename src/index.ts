/**
 * Cloudflare Worker for proxying requests to DeepSeek API with KV caching
 * Using proposal_id and timestamp as cache key for idempotency
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const CACHE_TTL = 5 * 60 * 1000;
const DEEPSEEK_API_KEY = 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // Replace with your actual API key

export interface Env {
	API_CACHE: KVNamespace; // Cloudflare KV 存储
}

interface RequestBody {
	proposal_id: string;
	timestamp: string;
	messages: { role: string; content: string }[];
	model: string;
}

export default {
	async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(req.url);

		// Log the incoming request URL
		console.log(`Request URL: ${req.url}`);

		// 检查是否为代理请求
		if (url.pathname === '/proxy') {
			try {
				// Log the raw request body (for debugging purposes)
				const rawBody = await req.text();
				console.log('Raw request body:', rawBody);

				// Parse the request body as JSON
				const requestBody: RequestBody = JSON.parse(rawBody);
				console.log('Parsed requestBody:', requestBody);

				// Extract proposal_id, timestamp, messages, and model
				const { proposal_id, timestamp, messages, model } = requestBody;
				console.log(
					`Extracted proposal_id: ${proposal_id}, timestamp: ${timestamp}, model: ${model}, messages: ${JSON.stringify(messages)}`
				);

				// Check if proposal_id, timestamp, messages, and model are present
				if (!proposal_id || !timestamp || !messages || !model) {
					return new Response('Missing required parameters: proposal_id, timestamp, messages, or model', {
						status: 400,
					});
				}

				// Log API_CACHE to check if it's properly linked
				console.log('API_CACHE:', env.API_CACHE);

				// Construct the cache key
				const cacheKey = `proposal:${proposal_id}:timestamp:${timestamp}`;
				console.log(`Cache Key: ${cacheKey}`);

				// Try to get the cached response from KV
				if (env.API_CACHE) {
					const cachedResponse = await env.API_CACHE.get(cacheKey);
					console.log(`Cached Response: ${cachedResponse}`);

					if (cachedResponse) {
						console.log('Returning cached response');
						return new Response(cachedResponse, { status: 200 });
					}
				} else {
					console.error('API_CACHE is undefined');
				}

				// Set up the headers for the DeepSeek API request
				const headers = {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${DEEPSEEK_API_KEY}`, // Use the constant here
				};

				// Send a request to the DeepSeek API
				const apiResponse = await fetch(DEEPSEEK_API_URL, {
					method: 'POST',
					headers: headers,
					body: JSON.stringify({
						proposal_id,
						timestamp,
						messages,
						model,
					}), // Send the body as JSON
				});

				const responseBody = await apiResponse.text();
				console.log(`API Response Body: ${responseBody}`);

				if (apiResponse.ok) {
					// Cache the API response in KV
					await env.API_CACHE.put(cacheKey, responseBody, {
						expirationTtl: CACHE_TTL / 1000, // Set the cache expiration TTL
					});

					return new Response(responseBody, { status: 200 });
				} else {
					return new Response(`API Error: ${responseBody}`, {
						status: apiResponse.status,
					});
				}
			} catch (err: unknown) {
				console.error('Error during request processing:', err);
				if (err instanceof Error) {
					return new Response(`Error processing the request: ${err.message}`, {
						status: 500,
					});
				} else {
					return new Response('An unknown error occurred', {
						status: 500,
					});
				}
			}
		}

		return new Response('Invalid endpoint', { status: 404 });
	},
};
