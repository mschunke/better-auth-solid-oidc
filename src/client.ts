import type { BetterAuthClientPlugin } from "better-auth/client";
import type { solidOidc } from "./index";

type SolidOidcPlugin = typeof solidOidc;

/**
 * Client companion to {@link solidOidc}.
 *
 * Sign-in itself needs no client plugin: a Solid Protocol Server is registered
 * as a social provider, so `authClient.signIn.social({ provider })` already
 * works. This exists to infer the server plugin's types on the client, which
 * gives typed access to the Client Identifier Document endpoint and keeps the
 * plugin pair conventional.
 *
 * @example
 * ```ts
 * import { createAuthClient } from "better-auth/client";
 * import { solidOidcClient } from "better-auth-solid-oidc/client";
 *
 * export const authClient = createAuthClient({
 *   plugins: [solidOidcClient()],
 * });
 * ```
 */
export const solidOidcClient = () =>
	({
		id: "solid-oidc",
		$InferServerPlugin: {} as ReturnType<SolidOidcPlugin>,
	}) satisfies BetterAuthClientPlugin;
