# Example Client

Minimal TypeScript client demonstrating how an external application sends SMS through the Gateway Server.

## Setup

```bash
cp .env.example .env
# Edit .env with your GATEWAY_URL and API_KEY
npm install
```

Create an API key on the server:

```bash
cd ../../server
npm run create-client -- "my-app"
```

## Run

```bash
npm start
```

The script sends a message, polls until a terminal status, then demonstrates idempotency.

OTP generation and verification are **not** part of this client — they belong in your application.
