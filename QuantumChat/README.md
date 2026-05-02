# QuantumChat — Hybrid PQC Encrypted Chat Application

A WhatsApp-like chat application secured with **Kyber-768 + AES-256-GCM** hybrid post-quantum cryptography.

## Architecture

```
QuantumChat/
├── Backend/          ← ASP.NET Core 9 + SignalR
│   ├── Controllers/  ← Auth, Users, Friends, Messages, Groups, Crypto
│   ├── Crypto/       ← HybridPqcService (BouncyCastle Kyber-1024 + AES-256-GCM)
│   ├── Data/         ← SQLite via EF Core (open with DB Browser for SQLite)
│   ├── Hubs/         ← ChatHub (SignalR real-time)
│   └── DTOs/         ← Request/response models
└── Frontend/         ← React 18 + TypeScript + Tailwind CSS
    └── src/
        ├── components/ ← Chat UI (WhatsApp-style dark theme)
        ├── services/   ← Axios API + SignalR client
        ├── store/      ← Zustand state management
        └── utils/      ← WebCrypto AES-256-GCM helpers
```

## Prerequisites

- **.NET 9 SDK** → https://dotnet.microsoft.com/download/dotnet/9.0
- **Node.js 20+** → https://nodejs.org
- **DB Browser for SQLite** (already installed) → https://sqlitebrowser.org

## Setup & Run

### 1. Backend

```bash
cd Backend
dotnet restore
dotnet run
# Server starts at http://localhost:5000
```

The SQLite database (`quantumchat.db`) is created automatically on first run.
Open it with **DB Browser for SQLite** to inspect all tables.

### 2. Frontend

```bash
cd Frontend
npm install
npm run dev
# Opens at http://localhost:5173
```

### 3. Test with two accounts

Open two browser windows (or use incognito for the second):
- Register **Alice** in window 1
- Register **Bob** in window 2
- Search for each other → Send friend request → Accept
- Start chatting — messages are encrypted end-to-end

## Cryptography Details

### Key Exchange: Kyber-768 (ML-KEM)
- **Standard**: NIST FIPS 203 (finalized 2024)
- **Library**: BouncyCastle 2.4.0
- **Security level**: 256-bit post-quantum (equivalent to AES-256)
- **Public key size**: 1,184 bytes
- **KEM ciphertext size**: 1,088 bytes
- **Shared secret size**: 32 bytes

### Symmetric Encryption: AES-256-GCM
- **Key derivation**: HKDF-SHA256 from Kyber shared secret
- **Nonce**: 96-bit random per message
- **Auth tag**: 128-bit (detects tampering)
- **Implementation**: .NET `System.Security.Cryptography.AesGcm` (hardware-accelerated)

### Private Key Storage
- Encrypted with **PBKDF2-SHA256 × 210,000 iterations** using user's password
- Wire format: `salt(16) | iv(12) | tag(16) | ciphertext`
- Server **never** sees plaintext private keys

### Group Key Distribution
- Random 32-byte group master secret generated at group creation
- Each member's copy is wrapped with their individual Kyber shared secret (XOR construction)
- Non-members have no ciphertext → see only garbage → GCM auth tag fails

## API Endpoints

| Method | Path                            | Description                        |
|--------|---------------------------------|------------------------------------|
| POST   | `/api/auth/register`            | Register + generate Kyber keys     |
| POST   | `/api/auth/login`               | Login + get encrypted private key  |
| GET    | `/api/users`                    | Search users                       |
| GET    | `/api/users/friends`            | List friends + KEM ciphertexts     |
| POST   | `/api/friends/request`          | Send friend request                |
| POST   | `/api/friends/respond`          | Accept/reject request              |
| GET    | `/api/messages/{friendId}`      | Load direct messages               |
| POST   | `/api/messages`                 | Send encrypted direct message      |
| POST   | `/api/messages/file`            | Send encrypted file (max 10 MB)    |
| POST   | `/api/groups`                   | Create group (friends only)        |
| GET    | `/api/groups/{id}/messages`     | Load group messages                |
| POST   | `/api/groups/{id}/messages`     | Send encrypted group message       |
| GET    | `/api/groups/{id}/mitm-demo`    | MitM demo: member vs outsider view |
| POST   | `/api/crypto/mitm-demo`         | Full encryption pipeline demo      |
| GET    | `/api/crypto/my-keys`           | View your Kyber key metadata       |
| POST   | `/api/crypto/decapsulate`       | Server-assisted KEM decapsulation  |

## SignalR Events

| Event                   | Direction        | Description                    |
|-------------------------|------------------|--------------------------------|
| `ReceiveMessage`        | Server → Client  | New direct message             |
| `ReceiveGroupMessage`   | Server → Client  | New group message              |
| `FriendRequestReceived` | Server → Client  | Incoming friend request        |
| `FriendRequestAccepted` | Server → Client  | Friend request accepted        |
| `AddedToGroup`          | Server → Client  | Added to a group               |
| `UserPresence`          | Server → Client  | Friend online/offline          |
| `UserTyping`            | Server → Client  | Typing indicator               |
| `GroupTyping`           | Server → Client  | Group typing indicator         |
| `MessagesRead`          | Server → Client  | Read receipts                  |

## MitM Attack Demo

Click the **MitM** button in any chat window header to:
1. See the Kyber KEM ciphertext that an attacker would intercept
2. See the AES-256-GCM encrypted payload
3. See what an **authorized recipient** decrypts (plaintext ✓)
4. See what the **attacker** sees (garbage + GCM auth failure ✗)

Also use `/api/groups/{id}/mitm-demo`:
- As a **member** → get your key material info
- As a **non-member** → get the attacker's garbage view

## Database Schema (SQLite)

Tables viewable in DB Browser for SQLite:
- `Users` — accounts, avatar colors, online status
- `UserKeyStores` — Kyber public keys + encrypted private keys
- `FriendRequests` — pending/accepted/rejected requests
- `Friendships` — friend pairs + KEM ciphertexts per user
- `Messages` — AES-256-GCM encrypted direct messages
- `Groups` — group metadata
- `GroupMembers` — per-member KEM-wrapped group keys
- `GroupMessages` — AES-256-GCM encrypted group messages

> ⚠️ All message content stored in the database is encrypted ciphertext.
> The server cannot read any messages.

Note: Copy appsettings.example.json to appsettings.json and update values before running.
