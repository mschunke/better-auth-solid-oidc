# better-auth-solid-oidc

[![npm](https://img.shields.io/npm/v/better-auth-solid-oidc.svg)](https://www.npmjs.com/package/better-auth-solid-oidc)
[![license](https://img.shields.io/npm/l/better-auth-solid-oidc.svg)](./LICENSE)

A community [Better Auth](https://better-auth.com) plugin that authenticates users against a
[Solid Protocol](https://solidproject.org/TR/protocol) Server, following the
[Solid-OIDC specification](https://solidproject.org/TR/oidc). Any conformant server works: the
plugin talks to the protocol, not to a particular implementation.

Solid identities are not ordinary OpenID Connect identities, so the plugin adds three things a
plain OIDC client does not do:

- **DPoP-bound tokens.** Every token request carries an [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html)
  proof of possession, and the key each refresh token is bound to is persisted encrypted so the
  refresh grant can replay it.
- **WebID identity.** The account is keyed by the `webid` claim rather than the provider's local
  `sub`, so a person keeps one Better Auth account across pods.
- **WebID/issuer confirmation.** The user's WebID document must name the provider as a trusted
  issuer, so a configured provider cannot assert a WebID it has no authority over.

The plugin also serves each provider's **Client Identifier Document**, which is how a Solid
Protocol Server identifies a client that was never pre-registered.

> [!NOTE]
> This is unrelated to `better-auth/solid`, which is the client integration for the
> [SolidJS](https://www.solidjs.com) framework. "Solid" here is the Solid Project protocol for
> personal data stores.

> [!WARNING]
> This is a community plugin. It is not maintained or verified by the Better Auth team.

## Requirements

- `better-auth` >= 1.7.0
- Node.js >= 20

## Installation

```bash
npm install better-auth-solid-oidc
```

```bash
pnpm add better-auth-solid-oidc
```

## Quick start

### 1. Add the server plugin

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { solidOidc } from "better-auth-solid-oidc";

export const auth = betterAuth({
  plugins: [
    solidOidc({
      config: [
        {
          providerId: "pod",
          issuer: "https://solid.example",
          clientIdDocument: {
            clientName: "My App",
            clientURI: "https://app.example.com",
          },
        },
      ],
    }),
  ],
});
```

### 2. Add the client plugin (optional)

Sign-in works without it, because a Solid Protocol Server is registered as a social provider. Add
it to infer the server plugin's types on the client:

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { solidOidcClient } from "better-auth-solid-oidc/client";

export const authClient = createAuthClient({
  plugins: [solidOidcClient()],
});
```

### 3. Migrate the database

The plugin adds one table for the DPoP keys refresh tokens are bound to.

```bash
npx @better-auth/cli migrate
```

```bash
npx @better-auth/cli generate
```

### 4. Publish the Client Identifier Document

The Solid Protocol Server dereferences your `client_id` over the network, so the document must be
reachable from the public internet at exactly that URL. With the configuration above it is served
at:

```
https://app.example.com/api/auth/solid/client-id/pod
```

Confirm it resolves before your first sign-in:

```bash
curl -H "Accept: application/ld+json" https://app.example.com/api/auth/solid/client-id/pod
```

### 5. Sign in

```ts
const { data } = await authClient.signIn.social({
  provider: "pod", // the providerId you configured
  callbackURL: "/dashboard",
});
```

## Reading the WebID

The WebID is stored as the account's `accountId`:

```ts
const accounts = await auth.api.listUserAccounts({ headers });
const solidAccount = accounts.find((account) => account.providerId === "pod");
const webId = solidAccount?.accountId;
```

To keep it on the user record too, map it during sign-in:

```ts
solidOidc({
  config: [
    {
      providerId: "pod",
      issuer: "https://solid.example",
      mapProfileToUser: (profile) => ({
        name: profile.name ?? profile.webid,
        webId: profile.webid, // requires an additional field on `user`
      }),
    },
  ],
});
```

### Placeholder emails

A Solid ID token asserts control of a WebID, not of an email address. Because `user.email` is
required and unique, the plugin synthesizes a stable, non-routable placeholder such as
`a1b2…@solid.placeholder.invalid` and leaves it unverified. Return an `email` from
`mapProfileToUser` to supply a real one.

## WebID and issuer confirmation

An OpenID Provider asserts a `webid` claim, but nothing in the token itself proves the provider is
allowed to speak for that WebID. Without a check, any provider you configure could assert any
WebID — including one belonging to a user of a different pod — and Better Auth would hand over that
user's account.

The plugin resolves this the way [Solid-OIDC §7](https://solidproject.org/TR/oidc#webid-issuer)
describes, in two steps:

1. **Issuer-hosted WebIDs.** If the WebID shares its scheme, host, and port with the issuer, the
   provider already controls the document, so nothing is fetched.
2. **Foreign WebIDs.** Otherwise the WebID document is dereferenced and must list the issuer under
   `solid:oidcIssuer`. JSON-LD and Turtle profile documents are both supported, and only statements
   whose subject is the WebID itself count.

Confirmation fails closed: an unreachable, unparseable, or silent document rejects the sign-in.

```ts
solidOidc({
  config: [
    {
      providerId: "pod",
      issuer: "https://solid.example",
      // Defaults shown explicitly.
      requireWebIdIssuerConfirmation: true,
      trustIssuerHostedWebId: true,
      // Resolve issuers your own way — an RDF library, a registry, a cache.
      getWebIdIssuers: async ({ webId }) => myRegistry.issuersFor(webId),
    },
  ],
});
```

> [!WARNING]
> Turning `requireWebIdIssuerConfirmation` off removes the only thing stopping a configured
> provider from asserting a WebID it does not control. Only do it for a provider that is the sole
> authority for every WebID it issues.

## DPoP

Solid-OIDC requires sender-constrained tokens. Every token-endpoint request the plugin makes
carries a DPoP proof signed with a freshly generated key, and the provider returns
`token_type: DPoP` along with a token bound to that key's thumbprint.

Because [RFC 9449 §5](https://www.rfc-editor.org/rfc/rfc9449.html#section-5) binds the refresh
token to the same key, the key is stored — encrypted with your instance secret — and replayed on
refresh. Rotate a refresh token and the plugin moves the binding with it.

A server that refuses the first token request with `use_dpop_nonce`
([RFC 9449 §8](https://www.rfc-editor.org/rfc/rfc9449.html#section-8)) is retried once with a
freshly signed proof carrying the nonce it supplied.

```ts
solidOidc({
  config: [
    {
      providerId: "pod",
      issuer: "https://solid.example",
      dpop: {
        algorithm: "ES256", // default
        persistRefreshKeys: true, // default
        requireDpopBoundTokens: true, // default
      },
      // Receives the key each token family is bound to, for pod requests
      // or your own key store.
      onTokenExchange: async ({ keyPair, accessToken }) => {
        await myPodClient.remember({ keyPair, accessToken });
      },
    },
  ],
});
```

> [!WARNING]
> `requireDpopBoundTokens: false` accepts a bearer token response. The access token is then not
> sender-constrained, so anyone who captures it can use it. Only disable it for a provider you know
> does not implement DPoP.

### Making pod requests

Authenticating the user is where this plugin stops; reading and writing pod resources is your
application's job. The building blocks are exported so you can mint proofs for those requests:

```ts
import { createSolidDpopProof } from "better-auth-solid-oidc";

const proof = await createSolidDpopProof({
  keyPair, // from `onTokenExchange`
  method: "GET",
  url: "https://storage.example/alice/notes",
  accessToken, // adds the `ath` claim RFC 9449 requires for resource requests
});

await fetch("https://storage.example/alice/notes", {
  headers: {
    authorization: `DPoP ${accessToken}`,
    dpop: proof,
  },
});
```

## Options

### `config`

One entry per Solid OpenID Provider.

| Option                           | Type                                                      | Default                                            | Description                                                                                                          |
| -------------------------------- | --------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `issuer`                         | `string`                                                  | —                                                  | **Required.** The provider's issuer identifier. Defines the account namespace and must match the discovery document. |
| `providerId`                     | `string`                                                  | `"solid"`                                          | ID used in `signIn.social`, the callback path, and the account record.                                               |
| `name`                           | `string`                                                  | `providerId`                                       | Display name.                                                                                                        |
| `discoveryUrl`                   | `string`                                                  | `<issuer>/.well-known/openid-configuration`        | Discovery document URL.                                                                                              |
| `discoveryHeaders`               | `Record<string, string>`                                  | —                                                  | Extra headers for the discovery fetch.                                                                               |
| `clientId`                       | `string`                                                  | the served document URL                            | Pre-registered client ID.                                                                                            |
| `clientSecret`                   | `string`                                                  | —                                                  | Secret for a statically registered client. Requires `clientIdDocument: false`.                                       |
| `tokenEndpointAuthMethod`        | `"none" \| "client_secret_basic" \| "client_secret_post"` | `"none"`, or `"client_secret_basic"` with a secret | Token endpoint client authentication.                                                                                |
| `clientIdDocument`               | `object \| false`                                         | `{}`                                               | Client Identifier Document metadata, or `false` to serve none.                                                       |
| `scopes`                         | `string[]`                                                | `["openid", "webid", "offline_access"]`            | Requested scopes. `openid` and `webid` are always included.                                                          |
| `redirectURI`                    | `string`                                                  | `<baseURL>/callback/<providerId>`                  | Overrides the callback URL.                                                                                          |
| `prompt`                         | `string`                                                  | —                                                  | `prompt` parameter for the authorization request.                                                                    |
| `authorizationUrlParams`         | `Record<string, string>`                                  | —                                                  | Extra authorization request parameters.                                                                              |
| `dpop`                           | `object`                                                  | see [DPoP](#dpop)                                  | DPoP behavior.                                                                                                       |
| `requireWebIdIssuerConfirmation` | `boolean`                                                 | `true`                                             | Confirm the WebID names this issuer.                                                                                 |
| `trustIssuerHostedWebId`         | `boolean`                                                 | `true`                                             | Skip the document lookup for a WebID the issuer hosts.                                                               |
| `getWebIdIssuers`                | `(input) => string[]`                                     | built-in lookup                                    | Replaces the WebID document lookup.                                                                                  |
| `mapProfileToUser`               | `(profile) => object`                                     | —                                                  | Maps the verified identity onto the user record.                                                                     |
| `onTokenExchange`                | `(input) => void`                                         | —                                                  | Receives the DPoP key each token family is bound to.                                                                 |
| `accessTokenExpiresIn`           | `number`                                                  | —                                                  | Fallback access-token lifetime for a provider that omits `expires_in`.                                               |
| `overrideUserInfo`               | `boolean`                                                 | `false`                                            | Overwrite stored user data on every sign-in.                                                                         |
| `disableSignUp`                  | `boolean`                                                 | `false`                                            | Disable sign up on this provider.                                                                                    |
| `disableImplicitSignUp`          | `boolean`                                                 | `false`                                            | Require `requestSignUp` for new users.                                                                               |
| `disableProviderLogout`          | `boolean`                                                 | `false`                                            | Disable RP-initiated logout.                                                                                         |
| `postLogoutRedirectURI`          | `string`                                                  | —                                                  | Default `post_logout_redirect_uri`.                                                                                  |

### `clientIdDocument`

| Option                   | Type                      | Description                                                                                                                                                                          |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clientId`               | `string`                  | Public URL the document is served from, and the `client_id`. Set this when the provider reaches you on a different origin than `baseURL` — behind a proxy, or on a separate ingress. |
| `clientName`             | `string`                  | Name shown on the provider's consent screen.                                                                                                                                         |
| `clientURI`              | `string`                  | Application home page.                                                                                                                                                               |
| `logoURI`                | `string`                  | Logo shown on the consent screen.                                                                                                                                                    |
| `tosURI`                 | `string`                  | Terms of service.                                                                                                                                                                    |
| `policyURI`              | `string`                  | Privacy policy.                                                                                                                                                                      |
| `contacts`               | `string[]`                | Email addresses responsible for the client.                                                                                                                                          |
| `postLogoutRedirectURIs` | `string[]`                | Post-logout redirect URIs.                                                                                                                                                           |
| `additionalMetadata`     | `Record<string, unknown>` | Extra document members, merged last.                                                                                                                                                 |

### Plugin Options

| Option                 | Type                | Default              | Description                                                                                        |
| ---------------------- | ------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `config`               | `SolidOidcConfig[]` | —                    | **Required.** Provider configurations.                                                             |
| `clientIdDocumentPath` | `string`            | `"/solid/client-id"` | Base path the documents are served from. Each provider's document is at `<basePath>/<providerId>`. |
| `schema`               | `object`            | —                    | Override the generated table and column names.                                                     |

## Endpoints

### `GET /solid/client-id/:providerId`

Returns the provider's Client Identifier Document as `application/ld+json`. Responds `404` for a
provider that is not configured or has `clientIdDocument: false`. Solid Protocol Servers call this
endpoint; your application does not need to.

## Database schema

The plugin requires one new table: **`solidDpopKey`**.

Rows are keyed by a SHA-256 hash of the refresh token they are bound to, never by the token itself,
and the private key is encrypted with your instance secret. A row is rewritten to the new hash
whenever the provider rotates the refresh token, and is collectable after `expiresAt`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Unique identifier for the stored key (primary key) |
| `providerId` | `string` | The Solid-OIDC provider the key belongs to |
| `tokenHash` | `string` | SHA-256 hex digest of the bound refresh token (unique) |
| `jkt` | `string` | RFC 7638 thumbprint of the public key, matching the token's cnf.jkt |
| `algorithm` | `string` | JWS algorithm the DPoP proof is signed with |
| `privateKey` | `string` | Private JWK, encrypted with the instance secret |
| `createdAt` | `Date` | When the key was created |
| `expiresAt` | `Date` | When the row becomes collectable |

> [!WARNING]
> The private keys in this table are only useful together with the refresh tokens on the `account`
> table, but both are credentials. Rotating your instance secret leaves existing rows impossible to
> decrypt, and affected users will have to sign in again.

## Limitations

- **Client-submitted ID tokens are rejected.** `signIn.social({ idToken })` is disabled for these
  providers: such a token arrives with no PKCE exchange and no DPoP binding, so it cannot establish
  a sender-constrained session.
- **WebID-first sign-in is not built in.** The plugin authenticates against providers you
  configure; it does not discover a provider from a WebID the user types. `fetchWebIdOidcIssuers`
  is exported for that, but it fetches whatever URL it is given — never pass one straight from a
  request without validating it first.
- **Pod access is out of scope.** The plugin establishes the identity and the bound tokens;
  reading and writing resources is left to your application. See
  [Making Pod Requests](#making-pod-requests).

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## License

[MIT](./LICENSE)
